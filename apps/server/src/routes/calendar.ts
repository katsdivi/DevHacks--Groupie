import { Router, type Response } from 'express';
import { CalendarIcsRequest, CalendarKind, type GoogleStartResponse } from '@groupie/shared';
import { tgUser } from '../auth.ts';
import { env } from '../env.ts';
import { feedKey } from '../canvas/crypto.ts';
import { calendarStatus, disconnect, saveIcsUrl, syncConnection, syncUser } from '../calendarSync.ts';
import { googleUserAvailable, googleUserClient, signOAuthState } from '../googleUser.ts';
import { IcsUrlError, normalizeIcsUrl } from '../icsBusy.ts';

/** How long a request waits for the first sync before answering with the status so far. */
export const FIRST_SYNC_WAIT_MS = 10_000;

/** Step 18a: Telegram-auth routes for calendar. Mounted on /api by api.ts (requireAuth already applied). */
export const calendarRouter = Router();

/** The Telegram user id, or null (after sending 403) for browser-link auth. */
function userId(res: Response): number | null {
  const user = tgUser(res);
  if (!user) {
    res.status(403).json({ error: 'telegram_only', message: 'Open Groupie from Telegram to connect a calendar.' });
    return null;
  }
  return user.id;
}

async function waitAtMost(p: Promise<unknown>, ms = FIRST_SYNC_WAIT_MS) {
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([p, new Promise((r) => (timer = setTimeout(r, ms)))]);
  clearTimeout(timer);
}

calendarRouter.get('/calendar/status', (_req, res) => {
  const uid = userId(res);
  if (uid == null) return;
  res.json(calendarStatus(uid));
});

calendarRouter.get('/calendar/google/start', (_req, res) => {
  const uid = userId(res);
  if (uid == null) return;
  if (!googleUserAvailable()) {
    return void res.status(503).json({ error: 'google_off', message: 'Google Calendar is not set up on this server. Paste a calendar link instead.' });
  }
  const body: GoogleStartResponse = { url: googleUserClient().authUrl(signOAuthState(uid, env.linkSigningSecret)) };
  res.json(body);
});

calendarRouter.put('/calendar/ics', async (req, res) => {
  const uid = userId(res);
  if (uid == null) return;
  if (!feedKey()) return void res.status(503).json({ error: 'calendar_off', message: 'Calendar links are not set up on this server.' });
  const parsed = CalendarIcsRequest.safeParse(req.body ?? {});
  if (!parsed.success) return void res.status(400).json({ error: 'bad_ics_url', message: 'Paste a calendar link (up to 2000 characters).' });
  let url: string;
  try {
    url = normalizeIcsUrl(parsed.data.url);
  } catch (err) {
    const message = err instanceof IcsUrlError ? err.message : 'That link does not look right.';
    return void res.status(400).json({ error: 'bad_ics_url', message });
  }
  saveIcsUrl(uid, url);
  await waitAtMost(syncConnection(uid, 'ics'));
  res.json(calendarStatus(uid));
});

calendarRouter.post('/calendar/sync', async (_req, res) => {
  const uid = userId(res);
  if (uid == null) return;
  await waitAtMost(syncUser(uid), FIRST_SYNC_WAIT_MS * 2);
  res.json(calendarStatus(uid));
});

calendarRouter.delete('/calendar/:kind', async (req, res) => {
  const uid = userId(res);
  if (uid == null) return;
  const kind = CalendarKind.safeParse(req.params.kind);
  if (!kind.success) return void res.status(400).json({ error: 'bad_kind', message: 'Unknown calendar type.' });
  await disconnect(uid, kind.data);
  res.json(calendarStatus(uid));
});
