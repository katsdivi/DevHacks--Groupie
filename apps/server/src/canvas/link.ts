import { SKILL_URL } from './bot.ts';
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { Composer, InlineKeyboard } from 'grammy';
import { Router } from 'express';
import {
  CUBBIE_LINK_RATE_LIMITS,
  CUBBIE_ME_DAYS,
  CUBBIE_SIGNATURE_HEADER,
  CubbieLinkRequest,
  PAIR_CODE_TTL_MS,
  cubbieLinkMessage,
  type CubbieLinkResponse,
  type CubbieMeResponse,
} from '@groupie/shared';
import { env } from '../env.ts';
import { db, schema } from '../db/index.ts';
import { bot } from '../bot/core.ts';
import { formatDue, html } from '../bot/format.ts';
import { meetingSummary } from '../bot/meeting.ts';
import { latestMeeting } from '../availability.ts';
import { addDays, upcomingForUser } from '../calendarQueries.ts';
import { getTasks } from '../groups.ts';
import { daysLeft } from '../progress.ts';
import { verifySignature } from './crypto.ts';
import { takeRateLimit } from './importer.ts';
import { claimPairCode, createPairCode, getPairCode } from './pairCodes.ts';
import { canvasDueLabel } from './personal.ts';
import { clientIp } from './routes.ts';
import { BUTTON, IMESSAGE_IN_GROUP, LINK_ERR, LINKED_DM, LINKED_MESSAGE, NOT_LINKED, UNLINK_IN_GROUP, UNLINKED } from '../copy.ts';
import { pendingGroupLine } from '../copy.ts';
import { projectGroupsFor } from '../membership.ts';

export { LINKED_DM, LINKED_MESSAGE };

/**
 * iMessage link (Telegram to Cubbie). /imessage makes a link code; the Skill trades it for a token
 * (POST /api/cubbie/link) and reads the student's own status with it (GET /api/cubbie/me).
 */

const { cubbieLinks, members } = schema;


type Reply = { status: number; body: object };
const fail = (status: number, error: string, message: string): Reply => ({ status, body: { error, message } });
const RATE_LIMITED = () => fail(429, 'rate_limited', LINK_ERR.busy);

/** sha256 hex. The only form of a token the server keeps. */
export const hashToken = (token: string) => createHash('sha256').update(token, 'utf8').digest('hex');

/** A fresh random 32-byte token, URL-safe. */
export const newToken = () => `grp_${randomBytes(32).toString('base64url')}`;

const nameFor = (telegramUserId: number) =>
  db.select({ name: members.name }).from(members).where(eq(members.tgUserId, telegramUserId)).limit(1).get()?.name ?? null;

/** Revokes every live token of this user. Returns how many. */
export function revokeAllLinks(telegramUserId: number, now = new Date()): number {
  return db
    .update(cubbieLinks)
    .set({ revokedAt: now.toISOString() })
    .where(and(eq(cubbieLinks.telegramUserId, telegramUserId), isNull(cubbieLinks.revokedAt)))
    .run().changes;
}

/** The live link for a raw token, or undefined. */
export function findLink(token: string) {
  return db
    .select()
    .from(cubbieLinks)
    .where(and(eq(cubbieLinks.tokenHash, hashToken(token)), isNull(cubbieLinks.revokedAt)))
    .get();
}

/** POST /api/cubbie/link: a signed, single-use link code in, a token out (once). */
export async function handleLink(rawBody: Buffer | undefined, signature: string | undefined, ip: string, now = new Date()): Promise<Reply> {
  const secret = env.cubbiePublicSigningKey;
  if (!secret) return fail(503, 'links_off', LINK_ERR.off);
  const L = CUBBIE_LINK_RATE_LIMITS.linkPerIp;
  if (!takeRateLimit(`cubbie-link-ip:${ip}`, L.limit, now.getTime(), L.windowMs)) return RATE_LIMITED();
  if (!rawBody || !verifySignature(secret, rawBody, signature)) return fail(401, 'bad_signature', 'Signature check failed.');
  let json: unknown;
  try {
    json = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return fail(400, 'bad_payload', LINK_ERR.unreadable);
  }
  const parsed = CubbieLinkRequest.safeParse(json);
  if (!parsed.success) return fail(400, 'bad_payload', LINK_ERR.badCode);
  const pc = getPairCode(parsed.data.pairCode);
  // An import code looks the same as a missing one here.
  if (!pc || pc.purpose !== 'link') return fail(404, 'unknown_code', LINK_ERR.unknown);
  if (pc.usedAt) return fail(409, 'code_used', LINK_ERR.used);
  if (pc.expiresAt <= now.toISOString()) return fail(409, 'code_expired', LINK_ERR.expired);
  if (!claimPairCode(pc.code, now)) return fail(409, 'code_used', LINK_ERR.used);

  const token = newToken();
  db.transaction((tx) => {
    // One live link per student: a new link replaces the old one.
    tx.update(cubbieLinks)
      .set({ revokedAt: now.toISOString() })
      .where(and(eq(cubbieLinks.telegramUserId, pc.telegramUserId), isNull(cubbieLinks.revokedAt)))
      .run();
    tx.insert(cubbieLinks).values({ telegramUserId: pc.telegramUserId, tokenHash: hashToken(token), createdAt: now.toISOString() }).run();
  });
  await bot.api.sendMessage(pc.telegramUserId, LINKED_DM).catch(() => {});
  const body: CubbieLinkResponse = { ok: true, token, name: nameFor(pc.telegramUserId), message: LINKED_MESSAGE };
  return { status: 200, body };
}

/** The bearer token from an Authorization header, or null. */
export function bearer(header: string | undefined): string | null {
  const m = /^Bearer\s+([A-Za-z0-9_-]{10,200})\s*$/i.exec(header ?? '');
  return m ? m[1]! : null;
}

const UNAUTHORIZED = () => fail(401, 'not_linked', LINK_ERR.notLinked);

/** Checks the per-IP and per-token limits and the token. Returns the link or a reply to send. */
function authorize(header: string | undefined, ip: string, now: Date) {
  const L = CUBBIE_LINK_RATE_LIMITS;
  if (!takeRateLimit(`cubbie-me-ip:${ip}`, L.mePerIp.limit, now.getTime(), L.mePerIp.windowMs)) return { reply: RATE_LIMITED() };
  const token = bearer(header);
  const link = token ? findLink(token) : undefined;
  if (!link) return { reply: UNAUTHORIZED() };
  if (!takeRateLimit(`cubbie-me-token:${link.tokenHash.slice(0, 24)}`, L.mePerToken.limit, now.getTime(), L.mePerToken.windowMs)) {
    return { reply: RATE_LIMITED() };
  }
  return { link };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Everything the token owner may see: their groups, their own tasks, each group's next meeting, and their own
 * calendar items for the next 7 days. No other member's calendar, memory, chat, or profile is read.
 */
export function meView(telegramUserId: number, now = new Date()): CubbieMeResponse {
  // Joined groups, plus groups they made codes or imports for without adding details (pending).
  const memberships = db.select().from(members).where(eq(members.tgUserId, telegramUserId)).all();
  const project = projectGroupsFor(telegramUserId);
  const groups = project.map(({ group, joined }) => {
    const memberIds = new Set(joined ? memberships.filter((m) => m.groupId === group.id).map((m) => m.id) : []);
    const tasks = getTasks(group.id);
    const mine = tasks.filter((t) => t.assigneeMemberId != null && memberIds.has(t.assigneeMemberId)).sort((a, b) => a.id - b.id);
    const meeting = latestMeeting(group.id);
    const upcomingMeeting = meeting && Date.parse(meeting.end) > now.getTime() ? meetingSummary(group.id, meeting) : null;
    return {
      title: group.title,
      assignmentTitle: group.assignmentTitle,
      dueDate: group.dueDate,
      dueLabel: formatDue(group.dueDate, group.tz),
      daysLeft: daysLeft(group.dueDate, group.tz, now),
      myTasks: mine.map((t) => ({ title: t.title, status: t.status, points: t.effort })),
      myTasksLeft: mine.filter((t) => t.status !== 'done').length,
      groupTasksDone: tasks.filter((t) => t.status === 'done').length,
      groupTasksTotal: tasks.length,
      nextMeeting: upcomingMeeting
        ? {
            start: upcomingMeeting.start,
            label: upcomingMeeting.label,
            mode: upcomingMeeting.mode,
            joinUrl: upcomingMeeting.join_url,
            location: upcomingMeeting.location,
          }
        : null,
    };
  });
  const upcoming = upcomingForUser(telegramUserId, now, addDays(now, CUBBIE_ME_DAYS)).map((e) => ({
    title: e.title,
    course: e.course,
    dueAt: e.dueAt,
    dueLabel: canvasDueLabel(e.dueAt) ?? e.dueAt,
    kind: e.kind,
  }));
  const myTasksLeft = groups.reduce((s, g) => s + g.myTasksLeft, 0);
  const pending = project.filter((p) => !p.joined).map((p) => pendingGroupLine(p.group.title));
  return {
    name: nameFor(telegramUserId),
    now: now.toISOString(),
    groups,
    upcoming,
    counts: { myTasksLeft, upcoming: upcoming.length, groups: groups.length },
    summary: [`${plural(myTasksLeft, 'task')} left, ${plural(upcoming.length, 'thing')} due in the next ${CUBBIE_ME_DAYS} days`, ...pending].join('. '),
  };
}

/** GET /api/cubbie/me. */
export function handleMe(header: string | undefined, ip: string, now = new Date()): Reply {
  const auth = authorize(header, ip, now);
  if (!auth.link) return auth.reply;
  db.update(cubbieLinks).set({ lastUsedAt: now.toISOString() }).where(eq(cubbieLinks.id, auth.link.id)).run();
  return { status: 200, body: meView(auth.link.telegramUserId, now) };
}

/** DELETE /api/cubbie/link: revokes the token that made the request. */
export function handleRevoke(header: string | undefined, ip: string, now = new Date()): Reply {
  const auth = authorize(header, ip, now);
  if (!auth.link) return auth.reply;
  db.update(cubbieLinks).set({ revokedAt: now.toISOString() }).where(eq(cubbieLinks.id, auth.link.id)).run();
  return { status: 200, body: { ok: true, message: LINK_ERR.unlinked } };
}

/** Public: mounted at /api/cubbie before the authed /api router. POST /link needs the raw body parser. */
export const cubbieLinkRouter = Router();

cubbieLinkRouter.post('/link', async (req, res) => {
  const raw = (req as unknown as { rawBody?: Buffer }).rawBody;
  const reply = await handleLink(raw, req.header(CUBBIE_SIGNATURE_HEADER), clientIp(req));
  res.status(reply.status).json(reply.body);
});

cubbieLinkRouter.delete('/link', (req, res) => {
  const reply = handleRevoke(req.header('authorization'), clientIp(req));
  res.status(reply.status).json(reply.body);
});

cubbieLinkRouter.get('/me', (req, res) => {
  const reply = handleMe(req.header('authorization'), clientIp(req));
  res.status(reply.status).json(reply.body);
});

// ---------------------------------------------------------------- bot commands

const minutes = PAIR_CODE_TTL_MS / 60_000;

/** The /imessage reply in a private chat. */
export function linkCodeText(code: string): string {
  return [
    '<b>1. First time only:</b> text Cubbie this and wait for it to say the skill is installed:',
    `<code>Install this skill: ${SKILL_URL}</code>`,
    '',
    `<b>2.</b> Then text Cubbie: <code>${html(cubbieLinkMessage(code))}</code>`,
    '',
    `The code works once, for ${minutes} minutes. After that, text Cubbie "Groupie status" to see your tasks, deadlines and next meeting in iMessage.`,
  ].join('\n');
}

export const linkComposer = new Composer();

linkComposer.command('imessage', async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== 'private') {
    return void (await ctx.reply(IMESSAGE_IN_GROUP, {
      reply_markup: new InlineKeyboard().url(BUTTON.dmMe, `https://t.me/${env.botUsername}`),
    }));
  }
  const pc = createPairCode(ctx.from.id, null, new Date(), undefined, 'link');
  await ctx.reply(linkCodeText(pc.code), { parse_mode: 'HTML' });
});

linkComposer.command('unlink', async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== 'private') return void (await ctx.reply(UNLINK_IN_GROUP));
  const n = revokeAllLinks(ctx.from.id);
  await ctx.reply(n ? UNLINKED : NOT_LINKED);
});

// ---------------------------------------------------------------- added for linked imports (canvas-ux)

/** True when the student has a live (not revoked) iMessage link. */
export function isLinked(telegramUserId: number): boolean {
  return !!db
    .select({ id: cubbieLinks.id })
    .from(cubbieLinks)
    .where(and(eq(cubbieLinks.telegramUserId, telegramUserId), isNull(cubbieLinks.revokedAt)))
    .get();
}

/** Marks a link as just used (the linked import calls this after the token checks out). */
export function touchLink(id: number, now = new Date()): void {
  db.update(cubbieLinks).set({ lastUsedAt: now.toISOString() }).where(eq(cubbieLinks.id, id)).run();
}
