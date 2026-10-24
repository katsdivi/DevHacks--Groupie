import { InlineKeyboard } from 'grammy';
import { colorEmoji } from '@groupie/shared';
import { bot, appUrl } from './core.ts';
import { html } from './format.ts';
import { getGroup, getTasks, setStatusMessage } from '../groups.ts';
import { listMembers } from '../members.ts';
import type { Group } from '../db/schema.ts';

export function joinStatusText(group: Group): string {
  const tasks = getTasks(group.id);
  const members = listMembers(group.id);
  const size = group.teamSize ?? members.length;
  const points = tasks.reduce((s, t) => s + t.effort, 0);
  const joined = members.map((m) => `${colorEmoji(m.color)} ${html(m.name)}`);
  const open = Array.from({ length: Math.max(0, size - members.length) }, () => '⚪');
  const full = members.length >= size;
  return [
    `<b>Got it: ${tasks.length} tasks, ${points} points.</b>`,
    full ? "Everyone's in. Love this team." : 'Everyone tap below to add your details.',
    '',
    [...joined, ...open].join('   '),
    '',
    `<b>${members.length}/${size} joined</b>`,
  ].join('\n');
}

const joinKeyboard = (groupId: number) => new InlineKeyboard().url('Add my details', appUrl(groupId, 'form'));

/** Posts a fresh join status message and makes it the one we keep editing. */
export async function postJoinStatus(groupId: number) {
  const group = getGroup(groupId);
  if (!group) return;
  const msg = await bot.api.sendMessage(groupId, joinStatusText(group), {
    parse_mode: 'HTML',
    reply_markup: joinKeyboard(groupId),
  });
  setStatusMessage(groupId, msg.message_id);
}

/** Edits the live "N/5 joined" message in place. */
export async function refreshJoinStatus(groupId: number) {
  const group = getGroup(groupId);
  if (!group?.statusMessageId) return;
  await bot.api
    .editMessageText(groupId, group.statusMessageId, joinStatusText(group), {
      parse_mode: 'HTML',
      reply_markup: joinKeyboard(groupId),
    })
    .catch((err) => {
      if (!String(err).includes('message is not modified')) console.error('refreshJoinStatus failed', err);
    });
}
