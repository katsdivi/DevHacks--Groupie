import { Composer, InlineKeyboard, InputFile } from 'grammy';
import { appUrl, bot } from './core.ts';
import { html } from './format.ts';
import { getGroup } from '../groups.ts';
import { listMembers } from '../members.ts';
import {
  addFairVote,
  applySplit,
  computeSplit,
  countFairVotes,
  setSplitMessage,
  splitCardData,
  splitView,
} from '../splitService.ts';
import { renderPng } from '../cards/render.ts';
import { splitCardHtml } from '../cards/splitCard.ts';

export const splitComposer = new Composer();

const pts = (n: number) => `${n} pt${n === 1 ? '' : 's'}`;

function splitKeyboard(groupId: number) {
  const votes = countFairVotes(groupId);
  const size = listMembers(groupId).filter((m) => !m.isSeed).length || listMembers(groupId).length;
  return new InlineKeyboard()
    .text(votes ? `Looks fair (${votes}/${size})` : 'Looks fair', 'split:fair')
    .url('Request swap', appUrl(groupId, 'split'));
}

export async function renderSplitPng(groupId: number): Promise<Buffer> {
  return renderPng(splitCardHtml(splitCardData(splitView(groupId, null))));
}

/** Posts the current split as a card and makes it the live one (older card loses its buttons). */
export async function postSplitCard(groupId: number, caption: string) {
  const group = getGroup(groupId);
  if (!group) return;
  const png = await renderSplitPng(groupId);
  const msg = await bot.api.sendPhoto(groupId, new InputFile(png, 'fair-split.png'), {
    caption,
    parse_mode: 'HTML',
    reply_markup: splitKeyboard(groupId),
  });
  if (group.splitMessageId) await bot.api.editMessageReplyMarkup(groupId, group.splitMessageId).catch(() => {});
  setSplitMessage(groupId, msg.message_id);
}

/** Runs the first split once everyone has joined. Safe to call after every join. */
export async function maybeRunSplit(groupId: number) {
  const group = getGroup(groupId);
  if (!group || group.status !== 'collecting_members' || !group.teamSize) return;
  if (listMembers(groupId).length < group.teamSize) return;
  const result = computeSplit(groupId);
  applySplit(groupId, result);
  await postSplitCard(
    groupId,
    `<b>${html(group.nickname)} here.</b> Fair split, done. Everyone is within ${pts(result.maxGap)} of each other.\nHappy? Tap <b>Looks fair</b>. Want to trade? <b>Request swap</b>.`,
  );
}

splitComposer.command('split', async (ctx) => {
  const group = getGroup(ctx.chat.id);
  if (!group || group.status === 'setup' || group.status === 'collecting_members') {
    await ctx.reply('No split yet. It lands as soon as everyone has joined.');
    return;
  }
  await ctx.replyWithChatAction('upload_photo').catch(() => {});
  const view = splitView(group.id, null);
  await postSplitCard(group.id, `<b>${html(group.nickname)} here.</b> Here's the current split. Max difference: ${pts(view.max_gap)}.`);
});

splitComposer.callbackQuery('split:fair', async (ctx) => {
  const groupId = ctx.chat!.id;
  const group = getGroup(groupId);
  if (!group || ctx.callbackQuery.message?.message_id !== group.splitMessageId) {
    await ctx.answerCallbackQuery({ text: "That's an older split. Vote on the newest card!" });
    return;
  }
  const added = addFairVote(groupId, ctx.from.id);
  if (!added) {
    await ctx.answerCallbackQuery({ text: 'Already counted you. Thanks!' });
    return;
  }
  await ctx.editMessageReplyMarkup({ reply_markup: splitKeyboard(groupId) }).catch(() => {});
  const humans = listMembers(groupId).filter((m) => !m.isSeed).length;
  const votes = countFairVotes(groupId);
  await ctx.answerCallbackQuery({ text: votes >= humans ? 'Unanimous. I might cry.' : 'Counted. Love a fair team.' });
});
