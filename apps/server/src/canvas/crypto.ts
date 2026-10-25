import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../env.ts';

/** The 32 byte feed key from FEED_ENCRYPTION_KEY (base64), or null when missing or the wrong length. */
export function feedKey(): Buffer | null {
  if (!env.feedEncryptionKey) return null;
  const key = Buffer.from(env.feedEncryptionKey, 'base64');
  return key.length === 32 ? key : null;
}

export class FeedKeyError extends Error {
  constructor() {
    super('FEED_ENCRYPTION_KEY is missing or not 32 bytes of base64');
  }
}

/** AES-256-GCM. Output: `v1:` + base64(iv | tag | ciphertext). */
export function encryptSecret(plain: string, key = feedKey()): string {
  if (!key) throw new FeedKeyError();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `v1:${Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64')}`;
}

/** Reverses `encryptSecret`. Throws if the key is wrong or the data was tampered with. */
export function decryptSecret(stored: string, key = feedKey()): string {
  if (!key) throw new FeedKeyError();
  if (!stored.startsWith('v1:')) throw new Error('Unknown secret format');
  const buf = Buffer.from(stored.slice(3), 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
}

/** `sha256=<hex>` over the raw body, as the Cubbie Skill sends it. */
export const signBody = (secret: string, body: Buffer | string) =>
  `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

/** Constant time check of the X-Groupie-Signature header. */
export function verifySignature(secret: string, body: Buffer, header: string | undefined): boolean {
  if (!header) return false;
  const expected = Buffer.from(signBody(secret, body));
  const got = Buffer.from(header.trim());
  return expected.length === got.length && timingSafeEqual(expected, got);
}
