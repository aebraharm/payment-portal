import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createFsDriver,
  createS3Driver,
  objectKeyFor,
  assertSafeRelativePath,
  safeSubdir,
  randomStoredName,
  storeFile,
  readStoredFile,
  storedFileExists,
  deleteStoredFile,
  resetStorageDriverCache,
} from '../../server/lib/storage.js';
import { config } from '../../server/config.js';

/**
 * Receipts are evidence of a customer's bank payment, so the storage layer has
 * two jobs: keep them reachable only through the authorising route, and keep a
 * hostile key from escaping its root — on the filesystem *and* in the bucket.
 * The S3 driver is exercised against a fake client that records commands, which
 * pins the exact Bucket/Key/ACL without needing an account.
 */
function makeFakeS3() {
  const calls = [];
  const objects = new Map();
  const client = {
    async send(command) {
      const name = command.constructor.name;
      calls.push({ name, input: command.input });
      if (name === 'PutObjectCommand') {
        objects.set(command.input.Key, { Body: command.input.Body, ContentType: command.input.ContentType });
        return {};
      }
      if (name === 'HeadObjectCommand') {
        if (!objects.has(command.input.Key)) {
          const err = new Error('NotFound');
          err.name = 'NotFound';
          err.$metadata = { httpStatusCode: 404 };
          throw err;
        }
        return { ContentLength: 1 };
      }
      if (name === 'GetObjectCommand') {
        const obj = objects.get(command.input.Key);
        if (!obj) throw new Error('NoSuchKey');
        // The real SDK hands back a stream-like body with this helper.
        return { Body: { transformToByteArray: async () => new Uint8Array(obj.Body) }, ContentType: obj.ContentType };
      }
      if (name === 'DeleteObjectCommand') {
        objects.delete(command.input.Key);
        return {};
      }
      throw new Error(`unexpected command ${name}`);
    },
  };
  return { client, calls, objects };
}

describe('storage path safety', () => {
  it('accepts the keys the application actually generates', () => {
    expect(assertSafeRelativePath('receipts/2026/10/6fabc.png')).toBe('receipts/2026/10/6fabc.png');
  });

  it('rejects traversal, absolute paths, encoded traversal and control characters', () => {
    for (const bad of ['../secret', 'a/../../b', '/etc/passwd', '..', '', 'a\0b', './x', 'a//b', 'C:/windows/x']) {
      expect(() => assertSafeRelativePath(bad), bad).toThrow();
    }
    // Backslashes are normalised to forward slashes before the check, so the
    // Windows-style traversal attempt is still caught.
    expect(() => assertSafeRelativePath('a\\..\\b')).toThrow();
  });

  it('normalises the object key and keeps it under the prefix', () => {
    expect(objectKeyFor('receipts/a.png')).toBe('payment-portal/receipts/a.png');
    // A leading slash is not quietly trimmed here: it is refused, so a path that
    // arrived from somewhere unexpected cannot be "fixed" into a valid key.
    expect(() => objectKeyFor('/receipts/a.png')).toThrow();
    expect(objectKeyFor('receipts/a.png', 'custom/pfx')).toBe('custom/pfx/receipts/a.png');
    // A misconfigured prefix that climbs out is refused rather than honoured:
    // silently relocating the store would leave files delete() cannot find.
    expect(() => objectKeyFor('receipts/a.png', '../escape')).toThrow(/prefix/i);
    expect(() => objectKeyFor('../escape/a.png')).toThrow();
  });

  it('builds date-partitioned subdirs and unguessable names', () => {
    expect(safeSubdir('receipts')).toMatch(/^receipts\/\d{4}\/\d{2}$/);
    const name = randomStoredName('png');
    expect(name).toMatch(/^[0-9a-f]{32}\.png$/);
    // Two calls must not collide, or one client could read another's receipt.
    expect(randomStoredName('png')).not.toBe(name);
  });
});

describe('filesystem driver (the self-hosted path)', () => {
  it('writes, reads, checks and deletes under its root only', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-storage-'));
    const driver = await createFsDriver({ root });
    const rel = 'receipts/2026/10/aaa.png';
    expect(driver.kind).toBe('fs');

    expect(await driver.exists({ relativePath: rel })).toBe(false);
    const put = await driver.put({ buffer: Buffer.from('bytes-a'), relativePath: rel });
    expect(put.relativePath).toBe(rel);
    expect(put.absolutePath).toBe(path.join(root, rel));
    expect(await driver.exists({ relativePath: rel })).toBe(true);
    expect((await driver.read({ relativePath: rel })).toString()).toBe('bytes-a');
    // Private by construction: nothing is published under a web root, and the
    // driver exposes no URL-producing method at all.
    expect(Object.keys(driver).sort()).toEqual(['delete', 'exists', 'kind', 'put', 'read', 'stream']);
    // 0600 — other users on a shared VPS must not read customer receipts.
    expect(fs.statSync(path.join(root, rel)).mode & 0o077).toBe(0);

    await driver.put({ buffer: Buffer.from('bytes-b'), relativePath: rel });
    expect((await driver.read({ relativePath: rel })).toString()).toBe('bytes-b');
    await driver.delete({ relativePath: rel });
    expect(await driver.exists({ relativePath: rel })).toBe(false);
    // Deleting twice is not an error; the row is the source of truth.
    await driver.delete({ relativePath: rel });
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('refuses a key that resolves outside the root', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-storage-'));
    fs.mkdirSync(path.join(root, 'receipts'), { recursive: true });
    const driver = await createFsDriver({ root });
    await expect(driver.read({ relativePath: '../escape.txt' })).rejects.toThrow();
    await expect(driver.put({ buffer: Buffer.from('x'), relativePath: '../escape.txt' })).rejects.toThrow();
    expect(fs.existsSync(path.join(path.dirname(root), 'escape.txt'))).toBe(false);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe('S3 driver (the serverless path)', () => {
  it('issues the right command for each operation', async () => {
    const { client, calls, objects } = makeFakeS3();
    // Mirrors what storage() builds in production: bucket + configured prefix.
    const driver = await createS3Driver({ client, bucket: 'test-bucket', prefix: 'payment-portal' });
    const rel = 'receipts/2026/10/aaa.png';
    expect(driver.kind).toBe('s3');

    expect(await driver.exists({ relativePath: rel })).toBe(false);
    await driver.put({ buffer: Buffer.from('receipt-bytes'), relativePath: rel, contentType: 'image/png' });
    const put = calls.at(-1);
    expect(put.name).toBe('PutObjectCommand');
    expect(put.input).toMatchObject({
      Bucket: 'test-bucket',
      Key: 'payment-portal/receipts/2026/10/aaa.png',
      ContentType: 'image/png',
    });
    // The default must stay private: a public-read receipt is a data leak, and
    // an unsigned/unknown ACL is rejected by real buckets that block ACPs.
    expect(put.input.ACL).toBeUndefined();
    expect(put.input.Grants).toBeUndefined();

    expect(await driver.exists({ relativePath: rel })).toBe(true);
    expect((await driver.read({ relativePath: rel })).toString()).toBe('receipt-bytes');
    expect(objects.size).toBe(1);

    // stream() is what GET /api/files/receipts/:id uses after the ownership check.
    const chunks = [];
    await driver.stream({
      relativePath: rel,
      res: { write: (c) => chunks.push(c), end: (c) => c && chunks.push(c) },
    });
    expect(Buffer.concat(chunks.map((c) => Buffer.from(c))).toString()).toBe('receipt-bytes');

    await driver.delete({ relativePath: rel });
    expect(calls.at(-1).name).toBe('DeleteObjectCommand');
    expect(calls.at(-1).input.Key).toBe('payment-portal/receipts/2026/10/aaa.png');
    expect(objects.size).toBe(0);
  });

  it('never issues a command that makes an object public', async () => {
    const { client, calls } = makeFakeS3();
    const driver = await createS3Driver({ client, bucket: 'b' });
    await driver.put({ buffer: Buffer.from('x'), relativePath: 'receipts/a.png' });
    await driver.read({ relativePath: 'receipts/a.png' });
    await driver.exists({ relativePath: 'receipts/a.png' });
    await driver.delete({ relativePath: 'receipts/a.png' });
    // Presigned URLs and ACL commands would both widen access beyond the
    // authorising route; the driver must only ever use direct object ops.
    for (const call of calls) {
      expect(call.name).toMatch(/^(PutObject|GetObject|HeadObject|DeleteObject)Command$/);
      expect(call.name).not.toMatch(/Acl|Policy|Presign/);
    }
    // Objects written without an explicit type must not be sniffable as HTML.
    expect(calls[0].input.ContentType).toBe('application/octet-stream');
  });

  it('applies server-side encryption only when it is configured', async () => {
    const withEnc = makeFakeS3();
    const original = config.storage.serverSideEncryption;
    config.storage.serverSideEncryption = true;
    try {
      const driver = await createS3Driver({ client: withEnc.client, bucket: 'b' });
      await driver.put({ buffer: Buffer.from('x'), relativePath: 'receipts/a.png' });
      expect(withEnc.calls.at(-1).input.ServerSideEncryption).toBe('AES256');
    } finally {
      config.storage.serverSideEncryption = original;
    }

    const plain = makeFakeS3();
    const plainDriver = await createS3Driver({ client: plain.client, bucket: 'b' });
    await plainDriver.put({ buffer: Buffer.from('y'), relativePath: 'receipts/b.png' });
    expect(plain.calls.at(-1).input.ServerSideEncryption).toBeUndefined();
  });

  it('honours an explicit empty prefix as the bucket root', async () => {
    // The prefix is a deployment choice, not a security control: with no prefix
    // the key must still be exactly the relative path, never a joined guess.
    const { client, calls } = makeFakeS3();
    const driver = await createS3Driver({ client, bucket: 'b', prefix: '' });
    await driver.put({ buffer: Buffer.from('x'), relativePath: 'receipts/a.png' });
    expect(calls[0].input.Key).toBe('receipts/a.png');
  });

  it('rejects unsafe keys before any request leaves the process', async () => {
    const { client, calls } = makeFakeS3();
    const driver = await createS3Driver({ client, bucket: 'b' });
    await expect(driver.put({ buffer: Buffer.from('x'), relativePath: '../escape.png' })).rejects.toThrow();
    await expect(driver.read({ relativePath: '/etc/passwd' })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('requires a bucket, because silently defaulting would write to another account', async () => {
    const { client } = makeFakeS3();
    await expect(createS3Driver({ client, bucket: '' })).rejects.toThrow(/S3_BUCKET/);
  });
});

describe('storeFile through the configured driver', () => {
  it('stores under the date subdir and returns only a relative path', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-upload-'));
    const originalDir = config.uploadDir;
    const originalDriver = config.storage.driver;
    config.uploadDir = root;
    config.storage.driver = 'fs';
    resetStorageDriverCache();
    try {
      const stored = await storeFile({ buffer: Buffer.from('receipt'), subdir: 'receipts', ext: 'png', contentType: 'image/png' });
      expect(stored.relativePath).toMatch(/^receipts\/\d{4}\/\d{2}\/[0-9a-f]{32}\.png$/);
      expect(stored.storedFilename).toBe(stored.relativePath.split('/').pop());
      expect(stored.sizeBytes).toBe(7);
      expect(path.isAbsolute(stored.relativePath)).toBe(false);
      expect(await storedFileExists(stored.relativePath)).toBe(true);
      expect((await readStoredFile(stored.relativePath)).toString()).toBe('receipt');

      await deleteStoredFile(stored.relativePath);
      expect(await storedFileExists(stored.relativePath)).toBe(false);
      // Missing files are treated as absent rather than raising a 500.
      expect(await storedFileExists('receipts/2020/01/00000000000000000000000000000000.png')).toBe(false);
      await expect(deleteStoredFile('receipts/2020/01/none.png')).resolves.toBeUndefined();
    } finally {
      config.uploadDir = originalDir;
      config.storage.driver = originalDriver;
      resetStorageDriverCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects an empty buffer before touching storage', async () => {
    await expect(storeFile({ buffer: Buffer.alloc(0), subdir: 'receipts', ext: 'png' })).rejects.toThrow(/empty/i);
  });
});
