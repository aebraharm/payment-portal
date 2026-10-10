import crypto from 'node:crypto';
import { config } from '../config.js';
import { FileValidationError } from './fileValidation.js';

// Re-exported so callers keep one import site for "upload a file" concerns.
export {
  RECEIPT_MIME_TYPES,
  LOGO_MIME_TYPES,
  FileValidationError,
  validateFileBuffer,
  sha256,
} from './fileValidation.js';

/**
 * Private file storage for uploaded receipts and the branding logo.
 *
 * Two drivers behind one async API:
 *   - `fs`  — a private directory under UPLOAD_DIR (VPS; what this project has
 *             always used).
 *   - `s3`  — a private S3-compatible bucket (Netlify, where the local
 *             filesystem is read-only and does not outlive an invocation).
 *
 * The invariant that matters for security: files are addressable **only** by the
 * relative path stored in the `receipts` table, and they are only ever read
 * back through `GET /api/files/receipts/:id`, which checks ownership. Nothing
 * here produces a public URL, and the bucket is expected to block public access.
 */

/** `receipts/2026/10` — always forward slashes, so an S3 key and an fs path agree. */
export function safeSubdir(prefix) {
  const now = new Date();
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${cleanRelative(prefix)}/${year}/${month}`;
}

/** Random storage name, so a stored object cannot be guessed or collided with. */
export function randomStoredName(ext) {
  return `${crypto.randomBytes(16).toString('hex')}.${ext}`;
}

function cleanRelative(value) {
  return String(value).replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

/**
 * Reject anything that could escape the storage root: `..`, absolute paths,
 * drive letters, NUL bytes, and leading slashes. Used by both drivers, because
 * a traversal bug in an S3 key is as bad as one in a filesystem path.
 */
export function assertSafeRelativePath(relativePath) {
  const value = String(relativePath ?? '').replace(/\\/g, '/');
  if (!value) throw new FileValidationError('Invalid storage path.');
  if (value.includes('\0') || value.startsWith('/') || /^[a-zA-Z]:/.test(value)) {
    throw new FileValidationError('Invalid storage path.');
  }
  const segments = value.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new FileValidationError('Invalid storage path.');
  }
  return segments.join('/');
}

/** Full object key inside the bucket, including the configured prefix. */
export function objectKeyFor(relativePath, prefixOverride) {
  const safe = assertSafeRelativePath(relativePath);
  const prefix = cleanRelative(prefixOverride ?? config.storage.prefix ?? '');
  // The prefix is operator input (S3_PREFIX), not user input — but it is joined
  // onto every key, so a stray `..` there would relocate the whole store. Failing
  // loudly beats writing receipts somewhere the delete path will never look.
  if (prefix && prefix.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new FileValidationError('Invalid storage prefix.');
  }
  const key = prefix ? `${prefix}/${safe}` : safe;
  if (key.length > 1024) throw new FileValidationError('Storage path is too long.');
  return key;
}

export async function createFsDriver({ root: rootOverride } = {}) {
  const fsp = await import('node:fs/promises');
  const nodePath = await import('node:path');
  const root = () => nodePath.resolve(rootOverride ?? config.uploadDir);
  const abs = (relativePath) => {
    const resolved = nodePath.resolve(root(), relativePath);
    // Defence in depth: the guard above already rejects traversal, and this
    // re-checks after resolution, exactly as the original implementation did.
    if (resolved !== root() && !resolved.startsWith(root() + nodePath.sep)) {
      throw new FileValidationError('Invalid storage path.');
    }
    return resolved;
  };
  return {
    kind: 'fs',
    async put({ buffer, relativePath }) {
      const target = abs(relativePath);
      await fsp.mkdir(nodePath.dirname(target), { recursive: true });
      await fsp.writeFile(target, buffer, { mode: 0o600 });
      return { relativePath, absolutePath: target };
    },
    async delete({ relativePath }) {
      try {
        await fsp.unlink(abs(relativePath));
      } catch (err) {
        if (err?.code !== 'ENOENT') throw err;
      }
    },
    async exists({ relativePath }) {
      try {
        await fsp.access(abs(relativePath));
        return true;
      } catch {
        return false;
      }
    },
    async read({ relativePath }) {
      return fsp.readFile(abs(relativePath));
    },
    async stream({ relativePath, res }) {
      const { createReadStream } = await import('node:fs');
      createReadStream(abs(relativePath)).pipe(res);
    },
  };
}

async function loadS3Sdk() {
  try {
    return await import('@aws-sdk/client-s3');
  } catch {
    throw new Error(
      '[storage] STORAGE_DRIVER=s3 needs the @aws-sdk/client-s3 package. Install it with: npm install @aws-sdk/client-s3'
    );
  }
}

/**
 * The object-store driver. `client` is injected (anything with `send(command)`),
 * which lets the tests assert the exact Bucket/Key/ContentType of every call
 * without a network. That matters: a wrong key here is a private receipt written
 * somewhere public, and a missing one is a file that can never be deleted.
 */
export async function createS3Driver({ client, bucket, prefix = '' } = {}) {
  const { PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } = await loadS3Sdk();
  if (!bucket) throw new Error('[storage] STORAGE_DRIVER=s3 requires S3_BUCKET.');
  const Key = (relativePath) => objectKeyFor(relativePath, prefix);
  return {
    kind: 's3',
    async put({ buffer, relativePath, contentType }) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: Key(relativePath),
          Body: buffer,
          ContentType: contentType || 'application/octet-stream',
          // Opt-in only: AWS S3 already encrypts every new object with SSE-S3,
          // and S3-compatible hosts (R2, B2, MinIO) reject the parameter. This is
          // about a *customer-managed* setting, not about privacy — what keeps an
          // object unreadable to the public is the bucket policy, which
          // DEPLOYMENT.md requires to block public access.
          ...(config.storage.serverSideEncryption ? { ServerSideEncryption: 'AES256' } : {}),
        })
      );
      return { relativePath };
    },
    async delete({ relativePath }) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: Key(relativePath) }));
    },
    async exists({ relativePath }) {
      try {
        await client.send(new HeadObjectCommand({ Bucket: bucket, Key: Key(relativePath) }));
        return true;
      } catch (err) {
        const name = err?.name ?? '';
        const status = err?.$metadata?.httpStatusCode;
        if (name === 'NotFound' || name === 'NoSuchKey' || status === 404) return false;
        throw err;
      }
    },
    async read({ relativePath }) {
      const out = await client.send(new GetObjectCommand({ Bucket: bucket, Key: Key(relativePath) }));
      return Buffer.from(await out.Body.transformToByteArray());
    },
    async stream({ relativePath, res }) {
      const out = await client.send(new GetObjectCommand({ Bucket: bucket, Key: Key(relativePath) }));
      const bytes = Buffer.from(await out.Body.transformToByteArray());
      res.end(bytes);
    },
  };
}

let cached = null;

export async function storage() {
  if (config.storage.driver === 's3') {
    const { S3Client } = await loadS3Sdk();
    const { bucket, region, endpoint, forcePathStyle, accessKeyId, secretAccessKey, prefix } = config.storage;
    const client = new S3Client({
      region,
      ...(endpoint ? { endpoint, forcePathStyle } : {}),
      ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
    });
    return createS3Driver({ client, bucket, prefix });
  }
  if (!cached) cached = createFsDriver();
  return cached;
}

/** Test/dev seam: drop the memoized driver (used after changing config). */
export function resetStorageDriverCache() {
  cached = null;
}

/**
 * Persist a validated buffer. `relativePath` is what belongs in
 * `receipts.stored_filename` / the branding setting — never an absolute path
 * and never a bucket key, so the same value works on both drivers.
 */
export async function storeFile({ buffer, subdir, ext, contentType }) {
  if (!buffer || buffer.length === 0) throw new FileValidationError('File is empty.');
  const relativePath = `${safeSubdir(subdir)}/${randomStoredName(ext)}`;
  assertSafeRelativePath(relativePath);
  const stored = await (await storage()).put({ buffer, relativePath, contentType });
  return {
    storedFilename: relativePath.split('/').pop(),
    relativePath: stored.relativePath ?? relativePath,
    absolutePath: stored.absolutePath,
    sizeBytes: buffer.length,
  };
}

export async function deleteStoredFile(relativePath) {
  if (!relativePath) return;
  try {
    await (await storage()).delete({ relativePath: assertSafeRelativePath(relativePath) });
  } catch {
    /* already gone — deletion is best effort, the row is the source of truth */
  }
}

export async function storedFileExists(relativePath) {
  if (!relativePath) return false;
  return (await storage()).exists({ relativePath: assertSafeRelativePath(relativePath) });
}

export async function readStoredFile(relativePath) {
  return (await storage()).read({ relativePath: assertSafeRelativePath(relativePath) });
}

/** Stream a stored object straight to the response (receipt/logo download). */
export async function streamStoredFile(relativePath, res) {
  await (await storage()).stream({ relativePath: assertSafeRelativePath(relativePath), res });
}

export async function storageDriverKind() {
  return (await storage()).kind;
}

