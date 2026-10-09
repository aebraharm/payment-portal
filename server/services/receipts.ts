// Receipt validation. Type and size are decided from the file's bytes (magic numbers), never from the
// file name or the browser-declared MIME type alone.

import { RECEIPT_TYPE_LABELS, type ReceiptMimeType } from '../../shared/constants';
import { badRequest, unprocessable } from '../lib/errors';

const MB = 1024 * 1024;

export function detectReceiptType(bytes: Uint8Array): ReceiptMimeType | null {
  const startsWith = (signature: number[]) => signature.every((value, index) => bytes[index] === value);
  if (startsWith([0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf'; // %PDF-
  if (startsWith([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  return null;
}

const DECLARED_ALIASES: Record<string, ReceiptMimeType> = {
  'application/pdf': 'application/pdf',
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
  'image/png': 'image/png',
};

export function inspectReceipt(
  bytes: Uint8Array,
  declaredType: string | null,
  maxBytes: number,
): { contentType: ReceiptMimeType; extension: 'pdf' | 'jpg' | 'png' } {
  if (bytes.length === 0) throw unprocessable('The receipt file is empty.', { receipt: 'Choose a file that is not empty.' });
  if (bytes.length > maxBytes) {
    throw unprocessable(`The receipt must be ${Math.floor(maxBytes / MB)} MB or smaller.`, {
      receipt: 'This file is too large.',
    });
  }
  const detected = detectReceiptType(bytes);
  if (!detected) {
    throw unprocessable('Upload a PDF, JPEG or PNG file.', { receipt: 'The file is not a PDF, JPEG or PNG.' });
  }
  const declared = declaredType ? DECLARED_ALIASES[declaredType.toLowerCase()] : undefined;
  if (declaredType && declaredType !== 'application/octet-stream' && declared !== detected) {
    throw unprocessable('The file type does not match its contents.', { receipt: 'Upload the original file, not a renamed one.' });
  }
  const extension = detected === 'application/pdf' ? 'pdf' : detected === 'image/jpeg' ? 'jpg' : 'png';
  return { contentType: detected, extension };
}

export function acceptedTypesText(): string {
  return Object.values(RECEIPT_TYPE_LABELS).join(', ');
}

export function assertReceiptId(value: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(value)) throw badRequest('Invalid receipt identifier.');
  return value;
}
