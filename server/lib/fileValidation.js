import crypto from 'node:crypto';
import path from 'node:path';

/**
 * Upload validation, kept separate from storage so the rules can be unit-tested
 * without touching the filesystem or an object store.
 */

export const RECEIPT_MIME_TYPES = {
  pdf: { mime: 'application/pdf', magic: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  jpg: { mime: 'image/jpeg', magic: [0xff, 0xd8, 0xff] },
  jpeg: { mime: 'image/jpeg', magic: [0xff, 0xd8, 0xff] },
  png: { mime: 'image/png', magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
};

export const LOGO_MIME_TYPES = {
  png: { mime: 'image/png', magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  jpg: { mime: 'image/jpeg', magic: [0xff, 0xd8, 0xff] },
  jpeg: { mime: 'image/jpeg', magic: [0xff, 0xd8, 0xff] },
  webp: { mime: 'image/webp', magic: [0x52, 0x49, 0x46, 0x46] }, // RIFF....WEBP
};

export class FileValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FileValidationError';
    this.status = 400;
  }
}

function matchesMagic(buffer, magic) {
  if (buffer.length < magic.length) return false;
  return magic.every((byte, i) => buffer[i] === byte);
}

/**
 * Validate an uploaded file buffer against an allow-list of extensions and
 * verify the actual content (magic bytes) rather than trusting the extension.
 */
export function validateFileBuffer({ buffer, originalName, allowed, maxBytes, label = 'File' }) {
  if (!buffer || buffer.length === 0) {
    throw new FileValidationError(`${label} is empty.`);
  }
  if (buffer.length > maxBytes) {
    const mb = (maxBytes / (1024 * 1024)).toFixed(0);
    throw new FileValidationError(`${label} exceeds the maximum size of ${mb} MB.`);
  }
  const ext = path.extname(originalName || '').toLowerCase().replace('.', '');
  const allowedDef = allowed[ext];
  if (!allowedDef) {
    throw new FileValidationError(
      `${label} type ".${ext || 'unknown'}" is not allowed. Allowed types: ${Object.keys(allowed).join(', ')}.`
    );
  }
  if (!matchesMagic(buffer, allowedDef.magic)) {
    throw new FileValidationError(
      `${label} content does not match its file type. Upload may be corrupted or mislabeled.`
    );
  }
  // WEBP: verify the full RIFF....WEBP signature.
  if (ext === 'webp') {
    const header = buffer.subarray(0, 12).toString('latin1');
    if (!header.startsWith('RIFF') || header.slice(8, 12) !== 'WEBP') {
      throw new FileValidationError(`${label} content does not match its file type.`);
    }
  }
  return { ext, mime: allowedDef.mime };
}

export function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}
