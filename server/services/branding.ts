// Branding assets (logo and favicon). Files are checked by their actual bytes, not by name or declared
// type, and are stored in the database because they are small and public by design.

import { FAVICON_MAX_BYTES, LOGO_MAX_BYTES } from '../../shared/constants';
import { sha256 } from '../lib/crypto';
import type { Queryable } from '../db/database';
import { unprocessable } from '../lib/errors';
import { recordAudit, type Actor } from './audit';
import { UUID_RE } from './common';

export type AssetKind = 'logo' | 'favicon';

export function detectImageType(bytes: Uint8Array): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  const ascii = (start: number, length: number) => String.fromCharCode(...bytes.slice(start, start + length));
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'image/webp';
  return null;
}

export async function storeBrandingAsset(
  db: Queryable,
  input: { kind: AssetKind; bytes: Uint8Array; declaredType: string | null; actor: Actor; now: Date },
): Promise<{ id: string; contentType: string; byteSize: number }> {
  const maxBytes = input.kind === 'logo' ? LOGO_MAX_BYTES : FAVICON_MAX_BYTES;
  if (input.bytes.length === 0) throw unprocessable('The file is empty.', { file: 'Choose a file.' });
  if (input.bytes.length > maxBytes) {
    throw unprocessable(`The ${input.kind} must be ${Math.round(maxBytes / 1024)} KB or smaller.`, {
      file: 'File is too large.',
    });
  }
  const detected = detectImageType(input.bytes);
  const allowed = input.kind === 'logo' ? ['image/png', 'image/jpeg', 'image/webp'] : ['image/png'];
  if (!detected || !allowed.includes(detected)) {
    throw unprocessable(
      input.kind === 'logo'
        ? 'Upload a PNG, JPEG or WebP logo.'
        : 'Upload a PNG favicon.',
      { file: 'The file content is not an accepted image type.' },
    );
  }
  if (input.declaredType && input.declaredType !== detected && input.declaredType !== 'application/octet-stream') {
    throw unprocessable('The file type does not match its contents.', { file: 'Mismatched file type.' });
  }
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO branding_assets (kind, content_type, byte_size, sha256, data, created_at, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [input.kind, detected, input.bytes.length, sha256(input.bytes), Buffer.from(input.bytes), input.now, input.actor.id],
  );
  await recordAudit(
    db,
    input.actor,
    {
      action: 'branding.asset_uploaded',
      summary: `Uploaded ${input.kind}`,
      entityType: 'branding_asset',
      entityId: rows[0].id,
      metadata: { contentType: detected, byteSize: input.bytes.length },
    },
    input.now,
  );
  return { id: rows[0].id, contentType: detected, byteSize: input.bytes.length };
}

export async function getBrandingAsset(
  db: Queryable,
  id: string,
): Promise<{ contentType: string; data: Uint8Array; sha256: string } | null> {
  if (!UUID_RE.test(id)) return null;
  const { rows } = await db.query<{ content_type: string; data: Uint8Array; sha256: string }>(
    'SELECT content_type, data, sha256 FROM branding_assets WHERE id = $1',
    [id],
  );
  const row = rows[0];
  return row ? { contentType: row.content_type, data: new Uint8Array(row.data), sha256: row.sha256 } : null;
}
