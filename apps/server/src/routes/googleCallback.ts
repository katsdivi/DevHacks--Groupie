import { Router } from 'express';
import { env } from '../env.ts';
import { saveGoogleToken, safeSyncError, syncConnection } from '../calendarSync.ts';
import { FREEBUSY_SCOPE, googleUserAvailable, googleUserClient, verifyOAuthState } from '../googleUser.ts';

/** Step 18a: public OAuth callback for per-user Google free/busy (GET /api/google/callback). Mounted before /api auth. */
export const googleCallbackRouter = Router();

const FIRST_SYNC_WAIT_MS = 10_000;

/** A small branded page. `title` and `body` are fixed strings from this file, never user input. */
export function callbackPage(ok: boolean, title: string, body: string): string {
  const accent = ok ? '#A6E35A' : '#FF6B5B';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer"><title>Groupie</title>
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#1E1E1E;color:#F2F2F2;
font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:16px;box-sizing:border-box}
.card{max-width:420px;width:100%;border:1px dashed #3A3A3A;border-radius:24px;padding:28px 24px;text-align:center}
.dot{width:44px;height:44px;border-radius:50%;margin:0 auto 18px;background:${accent};color:#1E1E1E;font-weight:900;
font-size:22px;line-height:44px}
.brand{font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:#9A9A9A;margin-bottom:10px}
h1{font-size:22px;margin:0 0 8px}p{margin:0;color:#B8B8B8;line-height:1.5;font-size:15px}
</style></head><body><main class="card"><div class="dot">${ok ? '&#10003;' : '!'}</div><div class="brand">Groupie</div>
<h1>${title}</h1><p>${body}</p></main></body></html>`;
}

googleCallbackRouter.get('/google/callback', async (req, res) => {
  res.set({ 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
  const fail = (status: number, title: string, body: string) => void res.status(status).type('html').send(callbackPage(false, title, body));
  if (!googleUserAvailable()) return fail(503, 'Google Calendar is not set up', 'Go back to Telegram and paste a calendar link instead.');
  const q = req.query as Record<string, unknown>;
  const state = typeof q.state === 'string' ? q.state : '';
  const uid = verifyOAuthState(state, env.linkSigningSecret);
  if (uid == null) return fail(400, 'This link expired', 'Go back to Telegram and tap Connect Google Calendar again.');
  if (typeof q.error === 'string') return fail(400, 'Calendar not connected', 'Google did not share access. You can try again from Telegram any time.');
  const code = typeof q.code === 'string' ? q.code : '';
  if (!code) return fail(400, 'Calendar not connected', 'Google did not send a code. Try again from Telegram.');

  let refreshToken: string | null;
  try {
    const t = await googleUserClient().exchangeCode(code);
    refreshToken = t.refreshToken;
    if (t.scope && !t.scope.split(/\s+/).includes(FREEBUSY_SCOPE)) {
      return fail(400, 'Calendar not connected', 'Groupie needs permission to see when you are busy. Try again and keep that box checked.');
    }
  } catch (err) {
    console.warn(`Google code exchange failed for user ${uid}: ${safeSyncError(err, [code])}`);
    return fail(502, 'Calendar not connected', 'Google did not accept the sign in. Try again from Telegram.');
  }
  if (!refreshToken) return fail(400, 'Calendar not connected', 'Google did not grant offline access. Try again from Telegram.');
  saveGoogleToken(uid, refreshToken);
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([syncConnection(uid, 'google'), new Promise((r) => (timer = setTimeout(r, FIRST_SYNC_WAIT_MS)))]);
  clearTimeout(timer);
  res.type('html').send(callbackPage(true, 'Calendar connected.', 'You can go back to Telegram.'));
});
