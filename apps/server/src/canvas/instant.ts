import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import { InlineKeyboard, type Context } from 'grammy';
import { DateTime } from 'luxon';
import { PAIR_CODE_TTL_MS, cubbieMessage } from '@groupie/shared';
import { db, schema } from '../db/index.ts';
import { env } from '../env.ts';
import { appUrl, bot } from '../bot/core.ts';
import { html } from '../bot/format.ts';
import { getGroup, type Group } from '../groups.ts';
import { expectingAssignment } from '../intake.ts';
import { getPrefs, isForbidden, markCannotDm } from '../prefs.ts';
import { addDays, sameCourse, upcomingForUser } from '../calendarQueries.ts';
import { isLinked, joinedGroupsFor, projectGroupsFor } from '../membership.ts';
import { createPairCode } from './pairCodes.ts';
import { IMPORT_UID_PREFIX } from './personal.ts';
import { OPEN_IN_IMESSAGE, cubbieOpenUrl } from './goCubbie.ts';
import { SKILL_URL } from './bot.ts';
import {
  BUTTON,
  CANVAS_BUTTON,
  CANVAS_DM_OPENER,
  CANVAS_DM_SENT,
  CANVAS_HEAD,
  CANVAS_NONE,
  CANVAS_NOT_CONNECTED,
  DM_BLOCKED,
  SPLIT_HAS_ASSIGNMENT,
  SPLIT_NOT_YOURS,
  canvasMore,
  canvasNotFound,
  installLine,
  splitText,
} from '../copy.ts';

/**
 * Instant /canvas answers ("/canvas what's due this week") from the asker's own calendar items and
 * earlier Cubbie imports. No model call, nothing fetched from Canvas, and nothing private posted in a group.
 */

const { calendarEvents, cubbieImports } = schema;

export type CanvasIntent = { kind: 'none' } | { kind: 'next' } | { kind: 'week' } | { kind: 'named'; query: string };

const WEEK = /\b(this|the|next)\s+week\b|\bweek(ly)?\b|\b7\s+days\b|\bsoon\b/i;
const NEXT = /\b(next|soonest|upcoming|nearest|closest)\b/i;
const DUE = /\bdue\b|\bdeadlines?\b/i;
/** Words that carry no assignment name. */
const FILLER = new Set(
  (
    "a an the my me i i'm im please pls send give get show tell pull find look up fetch open what what's whats is are " +
    "do does have has for about on of from in to it this that one ones info details detail full canvas assignment assignments " +
    'hw homework item items due deadline deadlines thing things can you could would hey hi groupie import'
  ).split(' '),
);

/** The intent of the text after /canvas. Deterministic. */
export function parseCanvasIntent(text: string | undefined | null): CanvasIntent {
  const t = (text ?? '').trim();
  if (!t) return { kind: 'none' };
  if (WEEK.test(t)) return { kind: 'week' };
  if (NEXT.test(t)) return { kind: 'next' };
  // Keep the person's own spelling of the name, minus the filler words around it.
  const kept = t.split(/\s+/).filter((tok) => words_(tok).some((w) => !FILLER.has(w)));
  const query = kept.join(' ').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N})]+$/gu, '').slice(0, 100);
  if (query) return { kind: 'named', query };
  return DUE.test(t) ? { kind: 'week' } : { kind: 'none' };
}

const words_ = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’']/g, "'")
    .split(/[^a-z0-9']+/)
    .map((w) => w.replace(/^'+|'+$/g, ''))
    .filter(Boolean);

/** One of the asker's Canvas items. `ref` is e<calendar id> or i<import id>. */
export type CanvasItem = {
  ref: string;
  title: string;
  course: string | null;
  dueAt: string | null;
  points: number | null;
  description: string | null;
  url: string | null;
  /** The group an import was made for, else null. */
  groupChatId: number | null;
};

type ImportPayload = {
  assignment?: { title?: string; dueAt?: string | null; pointsPossible?: number | null; descriptionText?: string | null; description?: string | null; url?: string | null };
  course?: { name?: string };
};

/** First sentence of a description, one line, at most 140 characters. */
export function firstSentence(text: string | null | undefined, max = 140): string | null {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const m = /^(.+?[.!?])(\s|$)/.exec(t);
  const s = (m ? m[1]! : t).trim();
  return s.length > max ? `${s.slice(0, max - 3).trimEnd()}...` : s;
}

const sameTitle = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const sameTime = (a: string | null, b: string | null) => !!a && !!b && Date.parse(a) === Date.parse(b);

/**
 * The asker's own items, soonest first: live calendar items due from now on, plus imports they made
 * (personal or for a group) and imports for groups they joined. Takes only the verified Telegram id.
 * An import also saved to the calendar shows once, with the import's points and description.
 */
export function ownCanvasItems(userId: number, now = new Date()): CanvasItem[] {
  const events = upcomingForUser(userId, now, addDays(now, 366), 500);
  const groupIds = joinedGroupsFor(userId).map((g) => g.group.id);
  const imports = db
    .select()
    .from(cubbieImports)
    .where(
      groupIds.length
        ? or(eq(cubbieImports.telegramUserId, userId), inArray(cubbieImports.groupChatId, groupIds))
        : eq(cubbieImports.telegramUserId, userId),
    )
    .orderBy(desc(cubbieImports.id))
    .all()
    .filter((r) => r.status !== 'failed');
  const uidOf = new Map(events.map((e) => [`e${e.id}`, e.uid]));
  const items: CanvasItem[] = events.map((e) => ({
    ref: `e${e.id}`,
    title: e.title,
    course: e.course,
    dueAt: e.dueAt,
    points: null,
    description: firstSentence(e.description),
    url: e.url,
    groupChatId: null,
  }));
  for (const r of imports) {
    const p = (r.payload ?? {}) as ImportPayload;
    const a = p.assignment;
    if (!a?.title) continue;
    const dueAt = a.dueAt && Number.isFinite(Date.parse(a.dueAt)) ? new Date(a.dueAt).toISOString() : null;
    if (dueAt && Date.parse(dueAt) < now.getTime()) continue;
    const extra = {
      points: a.pointsPossible ?? null,
      description: firstSentence(a.descriptionText || a.description),
      groupChatId: r.groupChatId,
    };
    const twin = items.find(
      (i) => i.ref.startsWith('e') && (uidOf.get(i.ref) === `${IMPORT_UID_PREFIX}${r.id}` || (sameTitle(i.title, a.title!) && sameTime(i.dueAt, dueAt))),
    );
    if (twin) {
      twin.points ??= extra.points;
      twin.description = extra.description ?? twin.description;
      twin.groupChatId ??= extra.groupChatId;
      continue;
    }
    // The same assignment imported twice: keep the newest (imports are newest first).
    if (items.some((i) => i.ref.startsWith('i') && sameTitle(i.title, a.title!) && i.dueAt === dueAt)) continue;
    items.push({ ref: `i${r.id}`, title: a.title, course: p.course?.name ?? null, dueAt, url: a.url ?? null, ...extra });
  }
  return items.sort((x, y) => (x.dueAt ? Date.parse(x.dueAt) : Infinity) - (y.dueAt ? Date.parse(y.dueAt) : Infinity));
}

/** True when the asker has any live calendar item (past or future) or any import. */
export function hasAnyCanvas(userId: number): boolean {
  const ev = db
    .select({ id: calendarEvents.id })
    .from(calendarEvents)
    .where(and(eq(calendarEvents.telegramUserId, userId), isNull(calendarEvents.removedAt)))
    .limit(1)
    .get();
  if (ev) return true;
  return !!db.select({ id: cubbieImports.id }).from(cubbieImports).where(eq(cubbieImports.telegramUserId, userId)).limit(1).get();
}

/** Items whose title contains every word of the query (numbers must match exactly), soonest first. */
export function findNamed(items: CanvasItem[], query: string): CanvasItem[] {
  const q = words_(query).filter((w) => !FILLER.has(w));
  if (!q.length) return [];
  const score = (title: string) => {
    const t = words_(title);
    const hit = (w: string) => (/^\d+$/.test(w) ? t.includes(w) : t.some((x) => x === w || (w.length >= 3 && x.startsWith(w))));
    return q.filter(hit).length / q.length;
  };
  const scored = items.map((i) => ({ i, s: score(i.title) })).filter((x) => x.s === 1);
  return scored.map((x) => x.i);
}

/** "Fri Nov 20, 11:59 PM MST" in `tz`, or null. */
export function dueLabelIn(dueAt: string | null, tz: string): string | null {
  if (!dueAt) return null;
  const d = DateTime.fromISO(dueAt, { setZone: true }).setZone(tz);
  return d.isValid ? d.toFormat('ccc LLL d, h:mm a ZZZZ') : null;
}

/** One item (HTML): title, then course, due and points, then the one-line description. */
export function itemText(i: CanvasItem, tz: string): string {
  const due = dueLabelIn(i.dueAt, tz);
  const facts = [i.course, due ? `Due ${due}` : 'No due date', i.points != null ? `${i.points} points` : null].filter(Boolean) as string[];
  return [`<b>${html(i.title)}</b>`, html(facts.join(' · ')), ...(i.description ? [html(i.description)] : [])].join('\n');
}

const MAX_LIST = 6;

/** A heading, the items, and an "and N more" line (HTML). */
export function listText(head: string, items: CanvasItem[], tz: string): string {
  const shown = items.slice(0, MAX_LIST);
  return [head, ...shown.map((i) => itemText(i, tz)), ...(items.length > shown.length ? [canvasMore(items.length - shown.length)] : [])].join('\n\n');
}

/** True when the item may be posted in this group: the group's own import, or the group's course. */
export function inGroupScope(i: CanvasItem, group: Group | undefined): boolean {
  if (!group) return false;
  if (i.groupChatId === group.id) return true;
  return !!group.canvasCourse && sameCourse(i.course, group.canvasCourse);
}

const MAX_TITLE = 120;
const clipTitle = (t: string) => t.replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE).trim();

/** The text a [Pull full details via Cubbie] button prefills: code-free when linked, else a fresh personal code. */
export function pullText(userId: number, title: string, linked: boolean, now = new Date()): string {
  const t = clipTitle(title);
  if (linked && t) return `Groupie import ${t}`;
  return cubbieMessage(createPairCode(userId, null, now).code, t || undefined);
}

/** Main Mini App link, for a DM from someone with no group yet. */
export const mainAppUrl = () => `https://t.me/${env.botUsername}/${env.miniAppShortName}`;

/** callback_data for [Split this one]. */
export const splitData = (ref: string) => `cv:split:${ref}`;
export const SPLIT_RE = /^cv:split:([ei]\d{1,12})$/;

function keyboardFor(userId: number, top: CanvasItem | undefined, linked: boolean, group: Group | undefined, now: Date) {
  const kb = new InlineKeyboard();
  if (!top) return kb;
  kb.url(CANVAS_BUTTON.pull, cubbieOpenUrl(pullText(userId, top.title, linked, now)));
  if (group && expectingAssignment(group)) kb.row().text(CANVAS_BUTTON.split, splitData(top.ref));
  return kb;
}

const withInstall = (text: string, linked: boolean) => (linked ? text : `${text}\n\n${installLine(SKILL_URL)}`);

/** Reply for someone with no calendar items and no imports. */
async function replyNothingConnected(ctx: Context, intent: CanvasIntent, group: Group | undefined, linked: boolean, now: Date) {
  const userId = ctx.from!.id;
  const words = intent.kind === 'named' ? clipTitle(intent.query) : '';
  let text: string;
  if (group && expectingAssignment(group)) text = cubbieMessage(createPairCode(userId, group.id, now).code, words || undefined);
  else text = pullText(userId, words, linked, now);
  const calendarGroup = group?.id ?? projectGroupsFor(userId)[0]?.group.id;
  const kb = new InlineKeyboard()
    .url(CANVAS_BUTTON.connect, calendarGroup != null ? appUrl(calendarGroup, 'calendar') : mainAppUrl())
    .row()
    .url(CANVAS_BUTTON.viaCubbie, cubbieOpenUrl(text));
  await ctx.reply(withInstall(CANVAS_NOT_CONNECTED, linked), { parse_mode: 'HTML', reply_markup: kb });
}

/**
 * Answers /canvas <free text> from the asker's own data. Returns false when the caller should run the
 * usual code flow instead (a named assignment not found in a group that is waiting for its assignment).
 */
export async function answerCanvas(ctx: Context, intent: CanvasIntent, now = new Date()): Promise<boolean> {
  const from = ctx.from;
  const chat = ctx.chat;
  if (!from || !chat || intent.kind === 'none') return false;
  const inGroup = chat.type === 'group' || chat.type === 'supergroup';
  const group = inGroup ? getGroup(chat.id) : undefined;
  const userId = from.id;
  const linked = isLinked(userId);
  const all = ownCanvasItems(userId, now);
  if (!all.length && !hasAnyCanvas(userId)) {
    await replyNothingConnected(ctx, intent, group, linked, now);
    return true;
  }
  let picked: CanvasItem[];
  let head: string;
  if (intent.kind === 'next') {
    picked = all.filter((i) => i.dueAt).slice(0, 1);
    head = CANVAS_HEAD.next;
  } else if (intent.kind === 'week') {
    const end = addDays(now, 7).getTime();
    picked = all.filter((i) => i.dueAt && Date.parse(i.dueAt) < end);
    head = CANVAS_HEAD.week;
  } else {
    picked = findNamed(all, intent.query);
    head = CANVAS_HEAD.named;
  }
  const tz = group?.tz ?? getPrefs(userId).tz;
  const replyTo = inGroup && ctx.msg ? { reply_parameters: { message_id: ctx.msg.message_id, allow_sending_without_reply: true } } : {};

  if (!picked.length) {
    if (intent.kind === 'named') {
      if (group && expectingAssignment(group)) return false;
      const kb = new InlineKeyboard().url(CANVAS_BUTTON.pull, cubbieOpenUrl(pullText(userId, intent.query, linked, now)));
      await ctx.reply(withInstall(canvasNotFound(intent.query), linked), { parse_mode: 'HTML', reply_markup: kb, ...replyTo });
    } else {
      await ctx.reply(CANVAS_NONE[intent.kind], replyTo);
    }
    return true;
  }

  if (!inGroup) {
    await ctx.reply(withInstall(listText(head, picked, tz), linked), {
      parse_mode: 'HTML',
      reply_markup: keyboardFor(userId, picked[0], linked, undefined, now),
    });
    return true;
  }

  // Group: only the group's own imports and this course's items go in the group; the rest goes by DM.
  const here = picked.filter((i) => inGroupScope(i, group));
  const away = picked.filter((i) => !inGroupScope(i, group));
  let trailer: string | null = null;
  if (away.length) {
    trailer = CANVAS_DM_SENT;
    try {
      const tzDm = getPrefs(userId).tz;
      await bot.api.sendMessage(userId, withInstall(`${CANVAS_DM_OPENER}\n\n${listText(head, away, tzDm)}`, linked), {
        parse_mode: 'HTML',
        reply_markup: keyboardFor(userId, away[0], linked, undefined, now),
      });
    } catch (err) {
      console.warn('canvas DM failed', err instanceof Error ? err.message.slice(0, 200) : err);
      if (isForbidden(err)) markCannotDm(userId);
      trailer = DM_BLOCKED;
    }
  }
  if (!here.length) {
    await ctx.reply(trailer!, replyTo);
    return true;
  }
  const body = [listText(head, here, tz), ...(trailer ? [trailer] : [])].join('\n\n');
  await ctx.reply(withInstall(body, linked), { parse_mode: 'HTML', reply_markup: keyboardFor(userId, here[0], linked, group, now), ...replyTo });
  return true;
}

/** [Split this one]: a group import code for the asker's item, with the Open in iMessage button. */
export async function onSplitTap(ctx: Context, ref: string, now = new Date()): Promise<void> {
  const from = ctx.from;
  const chatId = ctx.callbackQuery?.message?.chat.id ?? ctx.chat?.id;
  if (!from || chatId == null) return void (await ctx.answerCallbackQuery());
  const group = getGroup(chatId);
  const item = ownCanvasItems(from.id, now).find((i) => i.ref === ref);
  if (!item || !inGroupScope(item, group)) return void (await ctx.answerCallbackQuery({ text: SPLIT_NOT_YOURS, show_alert: true }));
  if (!group || !expectingAssignment(group)) return void (await ctx.answerCallbackQuery({ text: SPLIT_HAS_ASSIGNMENT, show_alert: true }));
  const message = cubbieMessage(createPairCode(from.id, group.id, now).code, clipTitle(item.title));
  await ctx.answerCallbackQuery();
  await ctx.api.sendMessage(chatId, splitText(item.title, message, PAIR_CODE_TTL_MS / 60_000), {
    parse_mode: 'HTML',
    reply_markup: new InlineKeyboard().url(OPEN_IN_IMESSAGE, cubbieOpenUrl(message)).copyText(BUTTON.copy, message),
  });
}
