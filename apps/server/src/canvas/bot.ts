import { Composer, InlineKeyboard, type Context } from 'grammy';
import { PAIR_CODE_TTL_MS, PairCodeString, cubbieMessage } from '@groupie/shared';
import { appUrl } from '../bot/core.ts';
import { html } from '../bot/format.ts';
import { getGroup } from '../groups.ts';
import { expectingAssignment } from '../intake.ts';
import { createPairCode, getPairCode, type PairCode } from './pairCodes.ts';
import { BUTTON, wrongAppText } from '../copy.ts';
import { linkComposer } from './link.ts';

export const canvasComposer = new Composer();
canvasComposer.use(linkComposer);

const minutes = PAIR_CODE_TTL_MS / 60_000;
/** The public Groupie Skill that Cubbie installs from a link (import, link, status). */
export const SKILL_URL = 'https://github.com/katsdivi/groupie-cubbie-skill/tree/main/groupie-import';

/** The /canvas reply: the code, the exact Cubbie message, and a button to the Canvas screen. */
export function canvasCodeText(code: string): string {
  return [
    `Your Cubbie code: <b>${html(code)}</b>`,
    '',
    '<b>1. First time only:</b> text Cubbie this and wait for it to say the skill is installed:',
    `<code>Install this skill: ${SKILL_URL}</code>`,
    '',
    `<b>2.</b> Then text Cubbie this within ${minutes} minutes (add the assignment name if you have several), and say yes when it asks:`,
    `<code>${html(cubbieMessage(code))}</code>`,
    '',
    "Cubbie reads the assignment from Canvas and sends it here. The code works once.",
  ].join('\n');
}

/** The /canvas reply in a private chat: a personal code, so the plan comes back here. */
export function personalCanvasCodeText(code: string): string {
  return [
    '<b>1. First time only:</b> text Cubbie this and wait for it to say the skill is installed:',
    `<code>Install this skill: ${SKILL_URL}</code>`,
    '',
    `<b>2.</b> Then text Cubbie this and say yes when it asks: <code>${html(cubbieMessage(code, '<assignment name>'))}</code>`,
    "I'll send you a plan here.",
    '',
    `The code works once, for ${minutes} minutes. For a group project, send /canvas in the project group instead.`,
  ].join('\n');
}

canvasComposer.command('canvas', async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type === 'private') {
    const pc = createPairCode(ctx.from.id, null);
    return void (await ctx.reply(personalCanvasCodeText(pc.code), { parse_mode: 'HTML' }));
  }
  if (ctx.chat.type !== 'group' && ctx.chat.type !== 'supergroup') return;
  const group = getGroup(ctx.chat.id);
  if (!group) return void (await ctx.reply('Send /setup first, then /canvas.'));
  if (!expectingAssignment(group)) {
    return void (await ctx.reply('This group already has its assignment, so there is nothing to import. Use /reset to start over.'));
  }
  const pc = createPairCode(ctx.from.id, group.id);
  await ctx.reply(canvasCodeText(pc.code), {
    parse_mode: 'HTML',
    reply_markup: new InlineKeyboard().url('Open Groupie', appUrl(group.id, 'canvas')),
  });
});

// ---------------------------------------------------------------- wrong app catch

/** Room for the code and words inside Telegram's 256 character copy button. */
const MAX_WRONG_APP_REST = 200;
/** "Groupie import K7Q2MX", optionally followed by assignment words. */
const WRONG_APP_RE = /^\s*groupie\s+import\s+([A-Z0-9]{6})\b([\s\S]*)$/i;

/** The code (uppercased) and any trailing words when the text is the Cubbie import message. Pure. */
export function matchWrongApp(text: string): { code: string; rest: string } | null {
  const m = WRONG_APP_RE.exec(text);
  if (!m) return null;
  return { code: m[1]!.toUpperCase(), rest: m[2]!.trim().replace(/\s+/g, ' ').slice(0, MAX_WRONG_APP_REST).trim() };
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
 * If the message is the Cubbie import message sent to Groupie by mistake, replies with the exact
 * message to send Cubbie (a fresh code if the old one is unknown, used, or expired) and returns true.
 * No model call. Group chats get a code for this group; DMs reuse the old code's group if it was the
 * sender's, else a personal code.
 */
export async function catchWrongApp(ctx: Context, now = new Date()): Promise<boolean> {
  const text = ctx.msg?.text;
  const from = ctx.from;
  const chat = ctx.chat;
  if (!text || !from || !chat) return false;
  const m = matchWrongApp(text);
  if (!m) return false;
  let code = ownLiveCode(m.code, from.id, now)?.code ?? null;
  const fresh = code == null;
  if (code == null) {
    const old = getPairCode(m.code);
    const oldGroup = old && old.telegramUserId === from.id ? old.groupChatId : null;
    const groupId = chat.type === 'private' ? importableGroup(oldGroup) : importableGroup(chat.id);
    code = createPairCode(from.id, groupId, now).code;
  }
  const message = cubbieMessage(code, m.rest || undefined);
  await ctx.reply(wrongAppText(message, fresh), {
    parse_mode: 'HTML',
    reply_markup: new InlineKeyboard().copyText(BUTTON.copy, message),
    ...(chat.type === 'private' ? {} : { reply_parameters: { message_id: ctx.msg!.message_id, allow_sending_without_reply: true } }),
  });
  return true;
}
