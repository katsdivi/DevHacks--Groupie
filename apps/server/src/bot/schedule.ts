import { Composer, InlineKeyboard } from 'grammy';
import { colorEmoji, formatMeeting } from '@groupie/shared';
import { appUrl, bot } from './core.ts';
import { html } from './format.ts';
import { getGroup } from '../groups.ts';
import { listMembers } from '../members.ts';
import {
  createMeeting,
  heatmap,
  latestMeeting,
  setAvailMessage,
  setGroupStatus,
  updateMeeting,
} from '../availability.ts';
import type { Group } from '../db/schema.ts';

export const scheduleComposer = new Composer();

const MODES = [
  { key: 'meet', label: 'Google Meet' },
  { key: 'zoom', label: 'Zoom' },
  { key: 'in_person', label: 'In person' },
] as const;

function availText(group: Group): string {
  const hm = heatmap(group.id);
  const meeting = group.status === 'active' ? latestMeeting(group.id) : undefined;
  const people = hm.members.map((m) => `${m.responded ? colorEmoji(m.color) : '⚪'} ${html(m.name)}`).join('   ');
  return [
    '<b>When is everyone free?</b>',
    meeting
      ? 'Times are locked. You can still peek at the heatmap.'
      : `Paint your free times for the week. ${html(group.nickname)} finds the hour that works for the most people.`,
    '',
    people,
    '',
    `<b>${hm.responded}/${hm.team_size} responded</b>`,
    ...(meeting ? ['', `Locked: <b>${html(formatMeeting(meeting.start, meeting.end, group.tz))}</b>`] : []),
  ].join('\n');
}

function availKeyboard(group: Group) {
  const kb = new InlineKeyboard().url('Fill your availability', appUrl(group.id, 'avail'));
  if (group.status !== 'active') kb.row().text('Lock it now', 'avail:lock');
  return kb;
}

/** Posts the availability message and moves the group into scheduling. */
export async function postAvailStatus(groupId: number) {
  let group = getGroup(groupId);
  if (!group) return;
  if (group.status === 'split_ready') setGroupStatus(groupId, 'scheduling');
  group = getGroup(groupId)!;
  const msg = await bot.api.sendMessage(groupId, availText(group), {
    parse_mode: 'HTML',
    reply_markup: availKeyboard(group),
  });
  if (group.availMessageId) await bot.api.editMessageReplyMarkup(groupId, group.availMessageId).catch(() => {});
  setAvailMessage(groupId, msg.message_id);
}

async function refreshAvailStatus(groupId: number) {
  const group = getGroup(groupId);
  if (!group?.availMessageId) return;
  await bot.api
    .editMessageText(groupId, group.availMessageId, availText(group), {
      parse_mode: 'HTML',
      reply_markup: availKeyboard(group),
    })
    .catch((err) => {
      if (!String(err).includes('message is not modified')) console.error('refreshAvailStatus failed', err);
    });
}

/** Called after anyone saves availability: updates the counter and locks once everyone is in. */
export async function onAvailabilityChanged(groupId: number) {
  const group = getGroup(groupId);
  if (!group) return;
  await refreshAvailStatus(groupId);
  const hm = heatmap(groupId);
  if (group.status === 'scheduling' && hm.responded >= hm.team_size && hm.team_size > 0) {
    await lockMeeting(groupId);
  }
}

/** Picks the best hour, posts it, then the meeting-type poll and the invite button. */
export async function lockMeeting(groupId: number): Promise<boolean> {
  const group = getGroup(groupId);
  if (!group) return false;
  const hm = heatmap(groupId);
  const best = hm.best[0];
  if (!best) {
    await bot.api.sendMessage(
      groupId,
      `${html(group.nickname)} here. Nobody's free times overlap yet. Paint a few more and try again?`,
      { parse_mode: 'HTML' },
    );
    return false;
  }
  const meeting = createMeeting(groupId, best.start, best.end);
  setGroupStatus(groupId, 'active');
  await refreshAvailStatus(groupId);

  const members = listMembers(groupId);
  const free = members.filter((m) => best.member_ids.includes(m.id));
  const busy = members.filter((m) => !best.member_ids.includes(m.id));
  await bot.api.sendMessage(
    groupId,
    [
      `<b>Best time: ${html(best.label)}</b>`,
      `${free.length}/${members.length} free: ${free.map((m) => `${colorEmoji(m.color)} ${html(m.name)}`).join(', ')}`,
      ...(busy.length ? [`Can't make it: ${busy.map((m) => html(m.name)).join(', ')}`] : []),
    ].join('\n'),
    { parse_mode: 'HTML' },
  );
  const poll = await bot.api.sendPoll(
    groupId,
    'How should we meet?',
    MODES.map((m) => ({ text: m.label })),
    { is_anonymous: false },
  );
  updateMeeting(meeting.id, { pollId: poll.poll?.id ?? null, pollMessageId: poll.message_id });
  await bot.api.sendMessage(groupId, 'Vote above, then tap below and I will send everyone the invite.', {
    reply_markup: new InlineKeyboard().text('Send Calendar Invite', 'cal:invite'),
  });
  return true;
}

scheduleComposer.command('avail', async (ctx) => {
  const group = getGroup(ctx.chat.id);
  if (!group || group.status === 'setup' || group.status === 'collecting_members') {
    await ctx.reply('Availability opens once everyone has joined and the split is out.');
    return;
  }
  await postAvailStatus(group.id);
});

scheduleComposer.callbackQuery('avail:lock', async (ctx) => {
  const group = getGroup(ctx.chat!.id);
  if (!group || group.status !== 'scheduling') {
    return void (await ctx.answerCallbackQuery({ text: 'Already locked in!' }));
  }
  if (heatmap(group.id).responded < 2) {
    return void (await ctx.answerCallbackQuery({ text: 'I need at least 2 people to answer first.', show_alert: true }));
  }
  await ctx.answerCallbackQuery({ text: 'Locking it in!' });
  await lockMeeting(group.id);
});

/** Closes the poll and returns the winning mode (ties go to the first option). */
async function closePoll(groupId: number) {
  const meeting = latestMeeting(groupId);
  if (!meeting) return null;
  if (meeting.mode) return meeting;
  let mode: (typeof MODES)[number]['key'] = 'meet';
  if (meeting.pollMessageId) {
    const poll = await bot.api.stopPoll(groupId, meeting.pollMessageId).catch(() => null);
    if (poll) {
      let top = -1;
      poll.options.forEach((o, i) => {
        if (o.voter_count > top) {
          top = o.voter_count;
          mode = MODES[i]!.key;
        }
      });
    }
  }
  updateMeeting(meeting.id, { mode });
  return { ...meeting, mode };
}

scheduleComposer.callbackQuery('cal:invite', async (ctx) => {
  const groupId = ctx.chat!.id;
  const meeting = await closePoll(groupId);
  if (!meeting) return void (await ctx.answerCallbackQuery({ text: 'Lock a time first.' }));
  await ctx.answerCallbackQuery();
  const label = MODES.find((m) => m.key === meeting.mode)?.label ?? 'Google Meet';
  const group = getGroup(groupId)!;
  const when = formatMeeting(meeting.start, meeting.end, group.tz);
  await ctx.reply(
    `<b>Locked in:</b> ${html(when)} on <b>${label}</b>.\n${html(group.nickname)} will send the calendar invite as soon as Google Calendar is connected.`,
    { parse_mode: 'HTML' },
  );
});
