import { Composer, InlineKeyboard, type Context } from 'grammy';
import { PAIR_CODE_TTL_MS, PairCodeString, cubbieMessage } from '@groupie/shared';
import { appUrl } from '../bot/core.ts';
import { html } from '../bot/format.ts';
import { getGroup } from '../groups.ts';
import { expectingAssignment } from '../intake.ts';
import { isLinked } from '../membership.ts';
import { createPairCode, getPairCode, type PairCode } from './pairCodes.ts';
import { BUTTON, LINK_FIRST_DM, LINK_FIRST_GROUP, wrongAppCubbieText } from '../copy.ts';
import { linkComposer } from './link.ts';
import { OPEN_IN_IMESSAGE, cubbieOpenUrl } from './goCubbie.ts';
import { SPLIT_RE, answerCanvas, onSplitTap, parseCanvasIntent } from './instant.ts';

export const canvasComposer = new Composer();
canvasComposer.use(linkComposer);

const minutes = PAIR_CODE_TTL_MS / 60_000;
/** The public Groupie Skill that Cubbie installs from a link (import, link, status). */
export const SKILL_URL = 'https://github.com/katsdivi/groupie-cubbie-skill/tree/main/groupie-import';

/** Options for the code replies: `linked` hides the install step, `hint` adds the assignment words. */
export type CodeTextOpts = { linked?: boolean; hint?: string };

const installStep = (linked: boolean | undefined) =>
  linked ? [] : ['<b>1. First time only:</b> text Cubbie this and wait for it to say the skill is installed:', `<code>Install this skill: ${SKILL_URL}</code>`, ''];

/** The /canvas reply: the code, the exact Cubbie message, and a button to the Canvas screen. */
export function canvasCodeText(code: string, opts: CodeTextOpts = {}): string {
  const step = opts.linked ? '' : '<b>2.</b> ';
  return [
    `Your Cubbie code: <b>${html(code)}</b>`,
    '',
    ...installStep(opts.linked),
    `${step}${opts.linked ? 'Text' : 'Then text'} Cubbie this within ${minutes} minutes (add the assignment name if you have several), and say yes when it asks:`,
    `<code>${html(cubbieMessage(code, opts.hint))}</code>`,
    '',
    "Cubbie reads the assignment from Canvas and sends it here. The code works once.",
  ].join('\n');
}

/** The /canvas reply in a private chat: a personal code, so the plan comes back here. */
export function personalCanvasCodeText(code: string, opts: CodeTextOpts = {}): string {
  const step = opts.linked ? '' : '<b>2.</b> ';
  return [
    ...installStep(opts.linked),
    `${step}${opts.linked ? 'Text' : 'Then text'} Cubbie this and say yes when it asks: <code>${html(cubbieMessage(code, opts.hint ?? '<assignment name>'))}</code>`,
    "I'll send you a plan here.",
    '',
    `The code works once, for ${minutes} minutes. For a group project, send /canvas in the project group instead.`,
  ].join('\n');
}

canvasComposer.command('canvas', async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== 'private' && ctx.chat.type !== 'group' && ctx.chat.type !== 'supergroup') return;
  // "/canvas what's due this week": answered right away from the sender's own items.
  const intent = parseCanvasIntent(ctx.match);
  if (await answerCanvas(ctx, intent)) return;
  const hint = intent.kind === 'named' ? intent.query : undefined;
  const linked = isLinked(ctx.from.id);
  if (ctx.chat.type === 'private') {
    const pc = createPairCode(ctx.from.id, null);
    const message = cubbieMessage(pc.code, hint);
    return void (await ctx.reply(personalCanvasCodeText(pc.code, { linked, hint }), {
      parse_mode: 'HTML',
      reply_markup: new InlineKeyboard().url(OPEN_IN_IMESSAGE, cubbieOpenUrl(message)),
    }));
  }
  const group = getGroup(ctx.chat.id);
  if (!group) return void (await ctx.reply('Send /setup first, then /canvas.'));
  if (!expectingAssignment(group)) {
    return void (await ctx.reply('This group already has its assignment, so there is nothing to import. Use /reset to start over.'));
  }
  const pc = createPairCode(ctx.from.id, group.id);
  await ctx.reply(canvasCodeText(pc.code, { linked, hint }), {
    parse_mode: 'HTML',
    reply_markup: new InlineKeyboard()
      .url(OPEN_IN_IMESSAGE, cubbieOpenUrl(cubbieMessage(pc.code, hint)))
      .row()
      .url('Open Groupie', appUrl(group.id, 'canvas')),
  });
});

canvasComposer.callbackQuery(SPLIT_RE, (ctx) => onSplitTap(ctx, ctx.match[1]!));

// ---------------------------------------------------------------- wrong app catch

/** Room for the code and words inside Telegram's 256 character copy button. */
const MAX_WRONG_APP_REST = 200;
/** "Groupie import K7Q2MX", optionally followed by assignment words. */
const WRONG_APP_RE = /^\s*groupie\s+import\s+([A-Z0-9]{6})\b([\s\S]*)$/i;
/** "Groupie import" with anything (or nothing) after it. */
const IMPORT_RE = /^\s*groupie\s+import\b([\s\S]*)$/i;
/** "Groupie status" alone, any case, optional punctuation. */
const STATUS_RE = /^\s*groupie\s+status\s*[.!?]*\s*$/i;

const tidy = (s: string) => s.trim().replace(/\s+/g, ' ').slice(0, MAX_WRONG_APP_REST).trim();

/** The code (uppercased) and any trailing words when the text is the Cubbie import message. Pure. */
export function matchWrongApp(text: string): { code: string; rest: string } | null {
  const m = WRONG_APP_RE.exec(text);
  if (!m) return null;
  return { code: m[1]!.toUpperCase(), rest: tidy(m[2]!) };
}

export type CubbieText = { kind: 'status' } | { kind: 'import'; code: string | null; rest: string };

/**
 * Any text meant for Cubbie: "Groupie status", or "Groupie import" with a code, with words only, or bare.
 * The first word counts as a code only if it uses the code alphabet and has a digit, was typed in
 * capitals, or `isKnownCode` says it exists, so "groupie import sprint 3" or "essay2" stay words.
 */
export function matchCubbieText(text: string, isKnownCode: (code: string) => boolean = () => false): CubbieText | null {
  if (STATUS_RE.test(text)) return { kind: 'status' };
  const coded = matchWrongApp(text);
  if (coded) {
    const raw = /^\s*groupie\s+import\s+(\S+)/i.exec(text)![1]!;
    const valid = PairCodeString.safeParse(coded.code).success;
    if (valid && (/\d/.test(raw) || raw === raw.toUpperCase() || isKnownCode(coded.code))) return { kind: 'import', ...coded };
  }
  const m = IMPORT_RE.exec(text);
  return m ? { kind: 'import', code: null, rest: tidy(m[1]!) } : null;
}

/** The group a code may still import into, or null for a personal code. */
const importableGroup = (groupChatId: number | null) => {
  if (groupChatId == null) return null;
  const g = getGroup(groupChatId);
  return g && expectingAssignment(g) ? g.id : null;
};

/**
 * The sender's own live import code, or null. Someone else's code counts as unknown, so the reply
 * never says anything about codes that are not theirs.
 */
function ownLiveCode(code: string, userId: number, now: Date): PairCode | null {
  const parsed = PairCodeString.safeParse(code);
  const pc = parsed.success ? getPairCode(parsed.data) : undefined;
  if (!pc || pc.purpose !== 'import' || pc.telegramUserId !== userId) return null;
  if (pc.usedAt || pc.expiresAt <= now.toISOString()) return null;
  if (pc.groupChatId != null && importableGroup(pc.groupChatId) == null) return null;
  return pc;
}

/**
 * If the message is meant for Cubbie ("Groupie import ...", "Groupie status"), replies with the exact
 * text to send Cubbie in a code block, an Open in iMessage button and a Copy button, and returns true.
 * No model call. A dead code gets a fresh one; group chats get a code for this group; DMs reuse the old
 * code's group if it was the sender's, else a personal code. Linked users get code-free imports in DMs.
 */
export async function catchWrongApp(ctx: Context, now = new Date()): Promise<boolean> {
  const text = ctx.msg?.text;
  const from = ctx.from;
  const chat = ctx.chat;
  if (!text || !from || !chat) return false;
  const m = matchCubbieText(text, (c) => !!getPairCode(c));
  if (!m) return false;
  const linked = isLinked(from.id);
  let message: string;
  let fresh = false;
  let extra: string | null = null;
  if (m.kind === 'status') {
    message = 'Groupie status';
    if (!linked) extra = chat.type === 'private' ? LINK_FIRST_DM : LINK_FIRST_GROUP;
  } else if (m.code == null && linked && chat.type === 'private' && m.rest) {
    message = `Groupie import ${m.rest}`;
  } else {
    let code = m.code ? (ownLiveCode(m.code, from.id, now)?.code ?? null) : null;
    if (code == null) {
      fresh = m.code != null;
      const old = m.code ? getPairCode(m.code) : undefined;
      const oldGroup = old && old.telegramUserId === from.id ? old.groupChatId : null;
      const groupId = chat.type === 'private' ? importableGroup(oldGroup) : importableGroup(chat.id);
      code = createPairCode(from.id, groupId, now).code;
    }
    message = cubbieMessage(code, m.rest || undefined);
  }
  await ctx.reply(wrongAppCubbieText(message, fresh, extra), {
    parse_mode: 'HTML',
    reply_markup: new InlineKeyboard().url(OPEN_IN_IMESSAGE, cubbieOpenUrl(message)).copyText(BUTTON.copy, message),
    ...(chat.type === 'private' ? {} : { reply_parameters: { message_id: ctx.msg!.message_id, allow_sending_without_reply: true } }),
  });
  return true;
}
