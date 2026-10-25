import { Composer, InlineKeyboard } from 'grammy';
import { PAIR_CODE_TTL_MS, cubbieMessage } from '@groupie/shared';
import { appUrl } from '../bot/core.ts';
import { html } from '../bot/format.ts';
import { getGroup } from '../groups.ts';
import { expectingAssignment } from '../intake.ts';
import { createPairCode } from './pairCodes.ts';

export const canvasComposer = new Composer();

const minutes = PAIR_CODE_TTL_MS / 60_000;

/** The /canvas reply: the code, the exact Cubbie message, and a button to the Canvas screen. */
export function canvasCodeText(code: string): string {
  return [
    `Your Cubbie code: <b>${html(code)}</b>`,
    '',
    `Text this to Cubbie within ${minutes} minutes:`,
    `<code>${html(cubbieMessage(code))}</code>`,
    '',
    "Cubbie reads the assignment from Canvas and sends it here. The code works once.",
  ].join('\n');
}

canvasComposer.command('canvas', async (ctx) => {
  if (ctx.chat.type !== 'group' && ctx.chat.type !== 'supergroup') {
    return void (await ctx.reply('Send /canvas in your project group, so I know where to post the assignment.'));
  }
  if (!ctx.from) return;
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
