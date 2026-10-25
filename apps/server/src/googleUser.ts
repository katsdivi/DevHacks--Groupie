import crypto from 'node:crypto';
import { auth, calendar } from '@googleapis/calendar';
import { env } from './env.ts';
import { feedKey } from './canvas/crypto.ts';
import type { BusyInterval } from './busy.ts';

/**
 * Per-user Google, free/busy only. Separate from the team account in calendar.ts: a Web OAuth client
 * (GOOGLE_USER_CLIENT_ID/SECRET) with the single calendar.freebusy scope. Never lists events.
 */

export const FREEBUSY_SCOPE = 'https://www.googleapis.com/auth/calendar.freebusy';
export const STATE_TTL_S = 10 * 60;

export const googleRedirectUri = () => `${env.publicUrl}/api/google/callback`;

/** True when everything per-user Google needs is configured. */
export const googleUserAvailable = () =>
  Boolean(env.googleUserClientId && env.googleUserClientSecret && env.publicUrl && env.linkSigningSecret && feedKey());

/** What the routes and sync need from Google. Swappable in tests. */
export type GoogleUserClient = {
  authUrl(state: string): string;
  /** Exchanges the consent code. `scope` is what the user actually granted, when Google says. */
  exchangeCode(code: string): Promise<{ refreshToken: string | null; scope: string | null }>;
  /** Busy intervals on the primary calendar in [timeMin, timeMax). Start and end only. */
  freeBusy(refreshToken: string, timeMin: string, timeMax: string): Promise<BusyInterval[]>;
  /** Best effort revoke on disconnect. */
  revoke(refreshToken: string): Promise<void>;
};

const oauth = () => new auth.OAuth2(env.googleUserClientId, env.googleUserClientSecret, googleRedirectUri());

export const realGoogleUserClient: GoogleUserClient = {
  authUrl: (state) =>
    oauth().generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: [FREEBUSY_SCOPE], state, include_granted_scopes: false }),
  async exchangeCode(code) {
    const { tokens } = await oauth().getToken(code);
    return { refreshToken: tokens.refresh_token ?? null, scope: tokens.scope ?? null };
  },
  async freeBusy(refreshToken, timeMin, timeMax) {
    const client = oauth();
    client.setCredentials({ refresh_token: refreshToken });
    const cal = calendar({ version: 'v3', auth: client });
    const res = await cal.freebusy.query({ requestBody: { timeMin, timeMax, items: [{ id: 'primary' }] } });
    const primary = res.data.calendars?.primary;
    if (primary?.errors?.length) throw new Error(`Google could not read free/busy (${primary.errors[0].reason ?? 'error'})`);
    return (primary?.busy ?? []).filter((b) => b.start && b.end).map((b) => ({ start: b.start!, end: b.end! }));
  },
  async revoke(refreshToken) {
    await oauth().revokeToken(refreshToken);
  },
};

let client: GoogleUserClient = realGoogleUserClient;
export const googleUserClient = () => client;

/** Swaps the Google client (tests). Returns the previous one. */
export function setGoogleUserClient(c: GoogleUserClient): GoogleUserClient {
  const prev = client;
  client = c;
  return prev;
}

type StatePayload = { u: number; exp: number; n: string; p: 'gcal' };
const b64url = (buf: Buffer) => buf.toString('base64url');

/** Signs the OAuth `state`: Telegram user id, expiry (10 min), nonce. HMAC with LINK_SIGNING_SECRET. */
export function signOAuthState(telegramUserId: number, secret: string, ttlS = STATE_TTL_S, nowS = Math.floor(Date.now() / 1000)) {
  const payload: StatePayload = { u: telegramUserId, exp: nowS + ttlS, n: b64url(crypto.randomBytes(9)), p: 'gcal' };
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = b64url(crypto.createHmac('sha256', `gcal-state:${secret}`).update(body).digest());
  return `${body}.${sig}`;
}

/** The Telegram user id from a valid, unexpired state, else null. */
export function verifyOAuthState(state: string, secret: string, nowS = Math.floor(Date.now() / 1000)): number | null {
  const [body, sig, extra] = state.split('.');
  if (!body || !sig || extra !== undefined || !secret) return null;
  const expected = crypto.createHmac('sha256', `gcal-state:${secret}`).update(body).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as StatePayload;
    if (p.p !== 'gcal' || !Number.isSafeInteger(p.u) || typeof p.exp !== 'number' || p.exp < nowS) return null;
    return p.u;
  } catch {
    return null;
  }
}
