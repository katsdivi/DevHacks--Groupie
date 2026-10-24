import crypto from 'node:crypto';
import type { LinkPayload } from '@groupie/shared';

const b64url = (buf: Buffer) => buf.toString('base64url');

/** Signs a browser link token for one member (default lifetime 14 days). */
export function signLinkToken(
  payload: Omit<LinkPayload, 'exp'>,
  secret: string,
  ttlS = 14 * 24 * 3600,
  nowS = Math.floor(Date.now() / 1000),
) {
  const body = b64url(Buffer.from(JSON.stringify({ ...payload, exp: nowS + ttlS })));
  const sig = b64url(crypto.createHmac('sha256', secret).update(body).digest());
  return `${body}.${sig}`;
}

export function verifyLinkToken(token: string, secret: string, nowS = Math.floor(Date.now() / 1000)): LinkPayload | null {
  const [body, sig] = token.split('.');
  if (!body || !sig || !secret) return null;
  const expected = crypto.createHmac('sha256', secret).update(body).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as LinkPayload;
    if (typeof p.g !== 'number' || typeof p.m !== 'number' || typeof p.exp !== 'number' || p.exp < nowS) return null;
    return p;
  } catch {
    return null;
  }
}
