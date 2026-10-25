import { Router, type ErrorRequestHandler, type Request, type Response } from 'express';
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
import { handleImport, importError, IMPORT_MESSAGES, newRequestId, takeRateLimit } from './importer.ts';
import { createPairCode, getPairCode, pairCodeStatus } from './pairCodes.ts';
import { pollFeed } from './poller.ts';

/** How long PUT /api/feed waits for the first poll before answering. */
export const FIRST_POLL_WAIT_MS = 10_000;

/**
 * Pair code limits, on top of the import's per-user and per-IP limits. Status polls allow a few students
 * behind one campus NAT, each polling every 2.5 s (24 a minute).
 */
export const PAIR_CODE_RATE_LIMITS = {
  createPerIp: { limit: 20, windowMs: 10 * 60 * 1000 },
  createGlobal: { limit: 600, windowMs: 60 * 60 * 1000 },
  statusPerIp: { limit: 240, windowMs: 60 * 1000 },
} as const;

type Limit = { limit: number; windowMs: number };

/** Takes one hit on each key in order; sends 429 and returns false on the first that is full. */
function underLimits(res: Response, checks: [string, Limit][], message: string): boolean {
  const now = Date.now();
  for (const [key, l] of checks) {
    if (!takeRateLimit(key, l.limit, now, l.windowMs)) {
      res.status(429).json({ error: 'rate_limited', message });
      return false;
    }
  }
  return true;
}

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
  const ip = clientIp(req);
  const L = PAIR_CODE_RATE_LIMITS;
  const checks: [string, Limit][] = [[`pc-create-ip:${ip}`, L.createPerIp], ['pc-create-all', L.createGlobal]];
  if (!underLimits(res, checks, 'Too many pair codes. Try again in a few minutes.')) return;
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
  const checks: [string, Limit][] = [[`pc-status-ip:${clientIp(req)}`, PAIR_CODE_RATE_LIMITS.statusPerIp]];
  if (!underLimits(res, checks, 'Checking too often. Wait a minute and try again.')) return;
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

/** Railway's per-request id, else a random one. Shown in every import error body and log line. */
const importRequestId = (req: Request) => req.header('x-railway-request-id')?.slice(0, 64) || newRequestId();

cubbieImportRouter.post('/', async (req, res) => {
  const raw = (req as unknown as { rawBody?: Buffer }).rawBody;
  const reply = await handleImport(raw, req.header(CUBBIE_SIGNATURE_HEADER), clientIp(req), { requestId: importRequestId(req) });
  res.status(reply.status).json(reply.body);
});

/**
 * Mount right after `cubbieImportRouter`: the body parser runs before the router, so its errors (body over
 * the limit, broken JSON) skip the router and land here. Answers in the same `{ error, message, requestId }` shape.
 */
export const cubbieImportErrors: ErrorRequestHandler = (err: { type?: string }, req, res, next) => {
  if (res.headersSent) return next(err);
  const id = importRequestId(req);
  const reply =
    err?.type === 'entity.too.large'
      ? importError(id, 'payload_too_large', IMPORT_MESSAGES.tooLarge)
      : err?.type === 'entity.parse.failed' || err?.type === 'encoding.unsupported' || err?.type === 'charset.unsupported'
        ? importError(id, 'invalid_payload', IMPORT_MESSAGES.notJson, err.type)
        : importError(id, 'server_error', IMPORT_MESSAGES.serverError, err?.type ?? 'unexpected');
  // The parser may stop reading a big body early; drain it so the client sees the answer, not a reset.
  req.resume();
  res.status(reply.status).set('connection', 'close').json(reply.body);
};
