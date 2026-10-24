import crypto from 'node:crypto';
import { TgUser } from '@groupie/shared';

const MAX_AGE_S = 24 * 60 * 60;

function hmac(key: crypto.BinaryLike, data: string) {
  return crypto.createHmac('sha256', key).update(data).digest();
}

function checkString(params: URLSearchParams, exclude: string[]) {
  return [...params.entries()]
    .filter(([k]) => !exclude.includes(k))
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');
}

/**
 * Validates Telegram Mini App initData (HMAC-SHA256 with key HMAC("WebAppData", botToken)).
 * Returns the user, or null if the signature is wrong, stale, or missing a user.
 */
export function validateInitData(initData: string, botToken: string, nowS = Date.now() / 1000): TgUser | null {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return null;
  const secret = hmac('WebAppData', botToken);
  const expected = Buffer.from(hash, 'hex');
  // Newer clients also send `signature`; accept the check string with or without it.
  const ok = [['hash'], ['hash', 'signature']].some((ex) =>
    crypto.timingSafeEqual(hmac(secret, checkString(params, ex)), expected),
  );
  if (!ok) return null;
  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate) || nowS - authDate > MAX_AGE_S) return null;
  try {
    const user = TgUser.safeParse(JSON.parse(params.get('user') ?? 'null'));
    return user.success ? user.data : null;
  } catch {
    return null;
  }
}

/** Builds signed initData. Used by tests and local screenshots. */
export function signInitData(fields: Record<string, string>, botToken: string): string {
  const params = new URLSearchParams(fields);
  const hash = hmac(hmac('WebAppData', botToken), checkString(params, [])).toString('hex');
  params.set('hash', hash);
  return params.toString();
}
