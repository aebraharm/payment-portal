// Password and access-code hashing with scrypt (memory-hard, OWASP-recommended). It uses Node's built-in
// implementation, so the serverless bundle has no native dependency.

import { randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const KEY_LENGTH = 64;
let params = { N: 2 ** 17, r: 8, p: 1 };
let dummyHash: Promise<string> | null = null;

function scrypt(secret: string, salt: Buffer, keyLength: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(secret, salt, keyLength, options, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

/** Test hook: lower the cost parameters so the suite stays fast. Never called in production code paths. */
export function setPasswordHashCost(override: Partial<{ N: number; r: number; p: number }>): void {
  params = { ...params, ...override };
  dummyHash = null;
}

export async function hashSecret(secret: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(secret.normalize('NFKC'), salt, KEY_LENGTH, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: 256 * 1024 * 1024,
  });
  return `scrypt$${params.N}$${params.r}$${params.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifySecret(secret: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, 'base64');
  const actual = await scrypt(secret.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: 256 * 1024 * 1024,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Runs a full verification against a dummy hash so unknown accounts take as long as real ones. */
export async function burnVerificationTime(secret: string): Promise<void> {
  dummyHash ??= hashSecret('timing-equaliser-not-a-real-password');
  await verifySecret(secret, await dummyHash);
}
