// S3-compatible driver (AWS S3, Cloudflare R2, Backblaze B2, MinIO). The bucket must stay private.
// Downloads are granted with short-lived presigned URLs after the server has checked authorization.

import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { S3Config } from '../config';
import { assertStorageKey, safeDownloadName, type ReceiptStorage } from './types';

const URL_TTL_SECONDS = 300;

export function createS3ReceiptStorage(config: S3Config): ReceiptStorage {
  const client = new S3Client({
    region: config.region,
    endpoint: config.endpoint ?? undefined,
    forcePathStyle: config.forcePathStyle,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });

  return {
    driver: 's3',
    async put(key, data, contentType) {
      assertStorageKey(key);
      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          Body: data,
          ContentType: contentType,
          CacheControl: 'private, no-store',
        }),
      );
    },
    async remove(key) {
      assertStorageKey(key);
      await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
    },
    async open(key, options) {
      assertStorageKey(key);
      const extension = key.split('.').pop() ?? 'bin';
      const disposition = `inline; filename="${safeDownloadName(options.filename, extension)}"`;
      const url = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: config.bucket,
          Key: key,
          ResponseContentType: options.contentType,
          ResponseContentDisposition: disposition,
          ResponseCacheControl: 'private, no-store',
        }),
        { expiresIn: URL_TTL_SECONDS },
      );
      return { kind: 'redirect', url, expiresInSeconds: URL_TTL_SECONDS };
    },
  };
}
