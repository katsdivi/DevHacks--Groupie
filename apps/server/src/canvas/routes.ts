import { Router, type Request, type Response } from 'express';
import {
  CUBBIE_SIGNATURE_HEADER,
  FeedPutRequest,
  PairCodeRequest,
  PairCodeString,
  cubbieMessage,
  normalizeFeedUrl,
  type FeedUpcomingResponse,
  type PairCodeResponse,
} from '@groupie/shared';
import { isGroupMember, tgUser } from '../auth.ts';
import { getGroup } from '../groups.ts';
import { feedKey } from './crypto.ts';
import { deleteFeed, feedStatus, saveFeed, upcomingEvents } from './feeds.ts';
import { handleImport } from './importer.ts';
import { createPairCode, getPairCode, pairCodeStatus } from './pairCodes.ts';
import { pollFeed } from './poller.ts';

/** How long PUT /api/feed waits for the first poll before answering. */
export const FIRST_POLL_WAIT_MS = 10_000;

/** Telegram-authed routes. Mounted on the `/api` router, after `requireAuth`. */
export const canvasRouter = Router();

/** The Telegram user id, or null (after sending 403) for browser-link auth. */
function userId(res: Response): number | null {
  const user = tgUser(res);
  if (!user) {
    res.status(403).json({ error: 'telegram_only', message: 'Open Groupie from Telegram to use Canvas.' });
    return null;
  }
  return user.id;
}

canvasRouter.post('/cubbie/pair-code', async (req, res) => {
  const uid = userId(res);
  if (uid == null) return;
  const parsed = PairCodeRequest.safeParse(req.body ?? {});
  if (!parsed.success) return void res.status(400).json({ error: 'bad_request', message: 'groupChatId must be a chat id.' });
  const groupChatId = parsed.data.groupChatId ?? null;
  if (groupChatId != null) {
    const group = getGroup(groupChatId);
    if (!group) return void res.status(404).json({ error: 'group_not_found', message: "I'm not in that group yet. Add me first!" });
    if (!(await isGroupMember(group.id, uid))) {
      return void res.status(403).json({ error: 'not_a_member', message: "You're not in this group, so I can't make a code for it." });
    }
  }
  const pc = createPairCode(uid, groupChatId);
  const body: PairCodeResponse = { code: pc.code, expiresAt: pc.expiresAt, cubbieMessage: cubbieMessage(pc.code) };
  res.json(body);
});

canvasRouter.get('/cubbie/pair-code/:code', (req, res) => {
  const uid = userId(res);
  if (uid == null) return;
  const code = PairCodeString.safeParse(req.params.code);
  const pc = code.success ? getPairCode(code.data) : undefined;
  // Someone else's code looks the same as a missing one, so codes can't be probed.
  if (!pc || pc.telegramUserId !== uid) return void res.status(404).json({ error: 'unknown_code', message: 'No such pair code.' });
  res.json(pairCodeStatus(pc));
});

canvasRouter.put('/feed', async (req, res) => {
  const uid = userId(res);
  if (uid == null) return;
  if (!feedKey()) return void res.status(503).json({ error: 'feeds_off', message: 'Calendar feeds are not set up on this server.' });
  const parsed = FeedPutRequest.safeParse(req.body ?? {});
  const url = parsed.success ? normalizeFeedUrl(parsed.data.feedUrl) : null;
  if (!url) {
    return void res
      .status(400)
      .json({ error: 'bad_feed_url', message: 'Paste the Calendar Feed link from Canvas (it starts with https://canvas.asu.edu/feeds/).' });
  }
  saveFeed(uid, url);
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([pollFeed(uid), new Promise((r) => (timer = setTimeout(r, FIRST_POLL_WAIT_MS)))]);
  clearTimeout(timer);
  res.json(feedStatus(uid));
});

canvasRouter.delete('/feed', (_req, res) => {
  const uid = userId(res);
  if (uid == null) return;
  deleteFeed(uid);
  res.json(feedStatus(uid));
});

canvasRouter.get('/feed/status', (_req, res) => {
  const uid = userId(res);
  if (uid == null) return;
  res.json(feedStatus(uid));
});

canvasRouter.get('/feed/upcoming', (_req, res) => {
  const uid = userId(res);
  if (uid == null) return;
  const body: FeedUpcomingResponse = { events: upcomingEvents(uid) };
  res.json(body);
});

/** The client IP. Behind one proxy (Railway) the last X-Forwarded-For hop is the real client. */
export function clientIp(req: Request): string {
  const xff = req.header('x-forwarded-for');
  const last = xff?.split(',').map((s) => s.trim()).filter(Boolean).pop();
  return last ?? req.socket.remoteAddress ?? 'unknown';
}

/** Public: POST /api/cubbie/import. Mount before the authed `/api` router. Needs the raw body parser. */
export const cubbieImportRouter = Router();

cubbieImportRouter.post('/', async (req, res) => {
  const raw = (req as unknown as { rawBody?: Buffer }).rawBody;
  const reply = await handleImport(raw, req.header(CUBBIE_SIGNATURE_HEADER), clientIp(req));
  res.status(reply.status).json(reply.body);
});
