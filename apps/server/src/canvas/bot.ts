import { Composer, InlineKeyboard } from 'grammy';
import { PAIR_CODE_TTL_MS, cubbieMessage } from '@groupie/shared';
import { appUrl } from '../bot/core.ts';
import { html } from '../bot/format.ts';
import { getGroup } from '../groups.ts';
import { expectingAssignment } from '../intake.ts';
import { createPairCode } from './pairCodes.ts';
import { linkComposer } from './link.ts';

export const canvasComposer = new Composer();
canvasComposer.use(linkComposer);

const minutes = PAIR_CODE_TTL_MS / 60_000;
/** The public Groupie import Skill that Cubbie installs from a link. */
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
    `Text this to Cubbie: <code>${html(cubbieMessage(code, '<assignment name>'))}</code>`,
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
  if (!group.teamSize) return void (await ctx.reply('Set the team size first: send /setup, then /canvas again.'));
  const pc = createPairCode(ctx.from.id, group.id);
  await ctx.reply(canvasCodeText(pc.code), {
    parse_mode: 'HTML',
    reply_markup: new InlineKeyboard().url('Open Canvas in Groupie', appUrl(group.id, 'canvas')),
  });
});
