// Filesystem driver for local development and self-hosted deployments with a persistent disk.
// Never use it on serverless platforms (see config.ts).

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { assertStorageKey, safeDownloadName, type DownloadTarget, type ReceiptStorage } from './types';

export function createLocalReceiptStorage(baseDir: string): ReceiptStorage {
  const root = path.resolve(baseDir);

  const resolve = (key: string): string => {
    assertStorageKey(key);
    const target = path.resolve(root, key);
    if (!target.startsWith(root + path.sep)) throw new Error('Refusing to write outside the receipt directory.');
    return target;
  };

  return {
    driver: 'local',
    async put(key, data) {
      const target = resolve(key);
      await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await writeFile(target, data, { flag: 'wx', mode: 0o600 });
    },
    async remove(key) {
      await rm(resolve(key), { force: true });
    },
    async open(key, options): Promise<DownloadTarget> {
      const data = await readFile(resolve(key));
      const extension = key.split('.').pop() ?? 'bin';
      return {
        kind: 'bytes',
        data: new Uint8Array(data),
        contentType: options.contentType,
        filename: safeDownloadName(options.filename, extension),
      };
    },
  };
}
