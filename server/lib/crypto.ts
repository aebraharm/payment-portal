import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

const REFERENCE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hmacSha256(key: string, value: string): string {
  return createHmac('sha256', key).update(value).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function randomChars(length: number, alphabet = REFERENCE_ALPHABET): string {
  let out = '';
  for (let i = 0; i < length; i += 1) out += alphabet[randomInt(alphabet.length)];
  return out;
}

/** Human-friendly, server-generated payment reference, for example PAY-20261009-K7QF2M. */
export function generatePaymentReference(prefix: string, isoDate: string): string {
  return `${prefix}-${isoDate.replaceAll('-', '')}-${randomChars(6)}`;
}
