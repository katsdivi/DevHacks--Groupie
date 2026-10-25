import { Composer, InlineKeyboard } from 'grammy';
import { DateTime } from 'luxon';
import { colorEmoji, formatMeeting, MEETING_MODES as MODES, MEETING_SLOTS, SLOT_MINUTES, slotEnd } from '@groupie/shared';
import { appUrl, bot } from './core.ts';
import { html } from './format.ts';
import { getGroup } from '../groups.ts';
import { listMembers } from '../members.ts';
import {
  createMeeting,
  dueAvailDeadlines,
  freeForHour,
  heatmap,
  latestMeeting,
  setAvailDeadline,
  setAvailMessage,
  setGroupStatus,
  topSlots,
  updateMeeting,
} from '../availability.ts';
import type { Group } from '../db/schema.ts';
import { askForMeetingLink } from './meeting.ts';
import { googleConfigured } from '../calendar.ts';
import { sendEmail } from '../gmail.ts';
import { signLinkToken } from '../linkToken.ts';
import { env } from '../env.ts';

export const scheduleComposer = new Composer();

function availText(group: Group): string {
  const hm = heatmap(group.id);
  const meeting = group.status === 'active' ? latestMeeting(group.id) : undefined;
  const people = hm.members.map((m) => `${m.responded ? colorEmoji(m.color) : '⚪'} ${html(m.name)}`).join('   ');
  return [
    '<b>When is everyone free?</b>',
    meeting
      ? 'Times are locked. You can still peek at the heatmap.'
      : "Paint your free times and I'll find the best hour.",
    '',
    people,
    '',
    `<b>${hm.responded}/${hm.team_size} responded</b>`,
    ...(meeting ? ['', `Locked: <b>${html(formatMeeting(meeting.start, meeting.end, group.tz))}</b>`] : []),
    ...(!meeting && group.status === 'active' ? ['', 'Vote on a time in the poll below.'] : []),
    ...(group.status === 'scheduling' && group.availDeadlineAt
      ? ['', `I'll pick times on <b>${html(deadlineLabel(group.availDeadlineAt, group.tz))}</b> even if not everyone is in.`]
      : []),
  ].join('\n');
}

/** "Sun, Oct 25, 4:00 PM" in the group's time zone. */
function deadlineLabel(iso: string, tz: string): string {
  return DateTime.fromISO(iso, { zone: 'utc' }).setZone(tz).toFormat('ccc, LLL d, h:mm a');
}

function availKeyboard(group: Group) {
  const kb = new InlineKeyboard().url('Fill your availability', appUrl(group.id, 'avail'));
  if (group.status !== 'active') kb.row().text('Lock it now', 'avail:lock');
  if (group.status === 'scheduling' && !group.availDeadlineAt) {
    kb.row().text('Lock in 24h', 'avail:deadline:24').text('Lock in 48h', 'avail:deadline:48');
  }
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
  await emailAvailabilityLinks(groupId).catch((err) => console.error('emailAvailabilityLinks failed', err));
}

/** Teammates who are only reachable by email (no Telegram) get their signed availability link. */
export async function emailAvailabilityLinks(groupId: number): Promise<number> {
  const group = getGroup(groupId);
  if (!group || !googleConfigured()) return 0;
  const targets = listMembers(groupId).filter((m) => !m.tgUserId && m.email && !m.isSeed);
  for (const m of targets) {
    const url = `${env.publicUrl}/?t=${signLinkToken({ g: groupId, m: m.id, n: m.name }, env.linkSigningSecret)}`;
    await sendEmail({
      to: [m.email!],
      subject: `When are you free? (${group.title})`,
      text: `Hi ${m.name}, ${group.nickname} here, helping ${group.title} find a meeting time.\n\nPaint your free times here (no app needed): ${url}\n\nThe link is just for you and works for 14 days.`,
      html: `<div style="font-family:Inter,Arial,sans-serif;max-width:520px"><p>Hi ${html(m.name)}, ${html(group.nickname)} here, helping <b>${html(group.title)}</b> find a meeting time.</p><p><a href="${url}" style="background:#A6E35A;color:#1E1E1E;padding:10px 18px;border-radius:999px;text-decoration:none;font-weight:600">Paint my free times</a></p><p style="color:#888">No app needed. The link is just for you and works for 14 days.</p></div>`,
    });
  }
  return targets.length;
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

const SLOT_MS = SLOT_MINUTES * 60_000;
const CONFIRM_PREFIX = 'time:confirm:';

/** Candidate starts packed into the Confirm button (slot index in base 36), so a restart loses nothing. */
export function encodeStarts(starts: string[]): string {
  return starts.map((s) => Math.round(Date.parse(s) / SLOT_MS).toString(36)).join('.');
}

export function decodeStarts(raw: string): string[] {
  return raw
    .split('.')
    .map((x) => parseInt(x, 36))
    .filter((n) => Number.isFinite(n) && n > 0)
    .map((n) => new Date(n * SLOT_MS).toISOString());
}

/** Index of the most-voted option; ties go to the higher-ranked (earlier) option. */
export function pickWinner(counts: number[]): number {
  let best = 0;
  counts.forEach((n, i) => {
    if (n > counts[best]!) best = i;
  });
  return best;
}

/** The last "no overlap" message per group, edited in place so repeat saves do not stack copies. */
const noOverlapMessages = new Map<number, number>();

export const noOverlapText = (nickname: string) =>
  `${html(nickname)} here. Nobody's free times overlap yet. Paint a few more, then tap <b>Lock it now</b>.`;

export const POLL_FAILED_TEXT = "I couldn't post the time poll. Tap <b>Lock it now</b> to try again?";

/**
 * Proposes times once everyone answered, the deadline passed, or someone tapped Lock it now.
 * No overlap: says so. One viable hour: straight to the meeting flow. Otherwise: the top 3 time poll.
 */
export async function lockMeeting(groupId: number): Promise<boolean> {
  const group = getGroup(groupId);
  if (!group) return false;
  const hm = heatmap(groupId);
  const picks = topSlots(hm.slots, group.tz, hm.team_size);
  if (!picks.length) {
    const text = noOverlapText(group.nickname);
    const prev = noOverlapMessages.get(groupId);
    const edited =
      prev !== undefined &&
      (await bot.api.editMessageText(groupId, prev, text, { parse_mode: 'HTML' }).then(
        () => true,
        (err) => String(err).includes('message is not modified'),
      ));
    if (!edited) noOverlapMessages.set(groupId, (await bot.api.sendMessage(groupId, text, { parse_mode: 'HTML' })).message_id);
    return false;
  }
  noOverlapMessages.delete(groupId);
  if (picks.length === 1) return startMeetingFlow(groupId, picks[0]!.start, picks[0]!.end);

  // Out of scheduling while the vote is open, so new saves and the deadline job do not post it again.
  setGroupStatus(groupId, 'active');
  try {
    await bot.api.sendPoll(
      groupId,
      'Which time works?',
      picks.map((p) => ({ text: p.label })),
      {
        is_anonymous: false,
        reply_markup: new InlineKeyboard().text('Confirm time', `${CONFIRM_PREFIX}${encodeStarts(picks.map((p) => p.start))}`),
      },
    );
  } catch (err) {
    console.error('Time poll failed', err);
    setGroupStatus(groupId, 'scheduling');
    await bot.api.sendMessage(groupId, POLL_FAILED_TEXT, { parse_mode: 'HTML' }).catch(() => {});
    return false;
  }
  await refreshAvailStatus(groupId);
  return true;
}

const confirming = new Set<number>();

/**
 * Closes the time poll and starts the meeting flow with the most-voted time.
 * Returns 'already' when the poll was closed before (someone else confirmed).
 */
export async function confirmTime(groupId: number, pollMessageId: number, starts: string[]): Promise<'done' | 'already' | 'error'> {
  if (!starts.length || confirming.has(groupId)) return 'already';
  confirming.add(groupId);
  try {
    let counts: number[] | null = null;
    try {
      const poll = await bot.api.stopPoll(groupId, pollMessageId);
      counts = poll.options.map((o) => o.voter_count);
    } catch (err) {
      return String(err).includes('already been closed') ? 'already' : 'error';
    }
    const start = starts[pickWinner(counts.slice(0, starts.length))] ?? starts[0]!;
    await startMeetingFlow(groupId, start, slotEnd(start, MEETING_SLOTS));
    return 'done';
  } finally {
    confirming.delete(groupId);
  }
}

/** Creates the meeting, posts the best time, then the meeting-type poll and the invite button. */
export async function startMeetingFlow(groupId: number, start: string, end: string): Promise<boolean> {
  const group = getGroup(groupId);
  if (!group) return false;
  const hm = heatmap(groupId);
  const freeIds = freeForHour(hm.slots, start);
  const meeting = createMeeting(groupId, start, end);
  setGroupStatus(groupId, 'active');
  await refreshAvailStatus(groupId);

  const members = listMembers(groupId);
  const free = members.filter((m) => freeIds.includes(m.id));
  const busy = members.filter((m) => !freeIds.includes(m.id));
  await bot.api.sendMessage(
    groupId,
    [
      `<b>Best time: ${html(formatMeeting(start, end, group.tz))}</b>`,
      `${free.length}/${members.length} free: ${free.map((m) => `${colorEmoji(m.color)} ${html(m.name)}`).join(', ')}`,
      ...(busy.length ? [`Can't make it: ${busy.map((m) => html(m.name)).join(', ')}`] : []),
    ].join('\n'),
    { parse_mode: 'HTML' },
  );
  // If the mode poll will not post, the invite still works: it defaults to Google Meet.
  const poll = await bot.api
    .sendPoll(groupId, 'How should we meet?', MODES.map((m) => ({ text: m.label })), { is_anonymous: false })
    .catch((err) => (console.error('Meeting mode poll failed', err), null));
  if (poll) updateMeeting(meeting.id, { pollId: poll.poll?.id ?? null, pollMessageId: poll.message_id });
  await bot.api.sendMessage(groupId, poll ? INVITE_PROMPT : INVITE_PROMPT_NO_POLL, {
    reply_markup: new InlineKeyboard().text('Send Calendar Invite', 'cal:invite'),
  });
  return true;
}

export const INVITE_PROMPT = "Vote above, then tap below and I'll send the invite.";
const INVITE_PROMPT_NO_POLL = "Tap below and I'll send the invite. It's Google Meet unless you /meetlink another.";

/** Proposes times for every group whose deadline passed. Clears the deadline first so it fires once. */
export async function checkAvailDeadlines(now = new Date()): Promise<number> {
  const due = dueAvailDeadlines(now);
  for (const g of due) {
    setAvailDeadline(g.id, null);
    await lockMeeting(g.id).catch((err) => console.error('deadline lockMeeting failed', err));
  }
  return due.length;
}

const DEADLINE_CHECK_MS = 5 * 60_000;

/** Starts the 5-minute deadline check. The lead calls this from index.ts. */
export function startAvailDeadlines(): ReturnType<typeof setInterval> {
  const timer = setInterval(() => {
    void checkAvailDeadlines().catch((err) => console.error('checkAvailDeadlines failed', err));
  }, DEADLINE_CHECK_MS);
  timer.unref?.();
  return timer;
}

/** Sets the deadline hours from now and refreshes the availability message. */
export async function setDeadlineIn(groupId: number, hours: number | null, now = new Date()) {
  setAvailDeadline(groupId, hours === null ? null : new Date(now.getTime() + hours * 3_600_000).toISOString());
  await refreshAvailStatus(groupId);
}

scheduleComposer.command('avail', async (ctx) => {
  const group = getGroup(ctx.chat.id);
  if (!group || group.status === 'setup' || group.status === 'collecting_members') {
    await ctx.reply('Availability opens once everyone joins and the split is out.');
    return;
  }
  await postAvailStatus(group.id);
});

/** Why a lock or deadline button does nothing: a time vote is open, or the meeting is set. */
const notSchedulingText = (groupId: number) =>
  latestMeeting(groupId) ? 'Already locked in!' : 'Voting on a time now. Tap Confirm time when ready.';

scheduleComposer.callbackQuery('avail:lock', async (ctx) => {
  const group = getGroup(ctx.chat!.id);
  if (!group || group.status !== 'scheduling') {
    return void (await ctx.answerCallbackQuery({ text: group ? notSchedulingText(group.id) : 'Already locked in!' }));
  }
  if (heatmap(group.id).responded < 2) {
    return void (await ctx.answerCallbackQuery({ text: 'I need at least 2 people to answer first.', show_alert: true }));
  }
  await ctx.answerCallbackQuery({ text: 'Locking it in!' });
  await lockMeeting(group.id);
});

scheduleComposer.callbackQuery(/^avail:deadline:(24|48)$/, async (ctx) => {
  const group = getGroup(ctx.chat!.id);
  if (!group || group.status !== 'scheduling') {
    return void (await ctx.answerCallbackQuery({ text: group ? notSchedulingText(group.id) : 'Already locked in!' }));
  }
  const hours = Number(ctx.match[1]);
  await ctx.answerCallbackQuery({ text: `I'll pick times in ${hours} hours.` });
  await setDeadlineIn(group.id, hours);
});

scheduleComposer.command('deadline', async (ctx) => {
  const group = getGroup(ctx.chat.id);
  if (!group || group.status !== 'scheduling') {
    return void (await ctx.reply('Deadlines work while we are finding a time. Start with /avail.'));
  }
  const arg = ctx.match.trim().toLowerCase();
  if (arg === 'off') {
    await setDeadlineIn(group.id, null);
    return void (await ctx.reply('Deadline off. I will wait for everyone.'));
  }
  const hours = Number(/^(\d{1,3})\s*h?$/.exec(arg)?.[1]);
  if (!hours || hours > 168) return void (await ctx.reply('Send it like this: /deadline 24h (or /deadline off).'));
  await setDeadlineIn(group.id, hours);
  const at = getGroup(group.id)!.availDeadlineAt!;
  await ctx.reply(`Got it. I'll pick times on ${deadlineLabel(at, group.tz)}, even if not everyone is in.`);
});

scheduleComposer.callbackQuery(/^time:confirm:([0-9a-z.]+)$/, async (ctx) => {
  const groupId = ctx.chat!.id;
  const messageId = ctx.callbackQuery.message?.message_id;
  if (!messageId) return void (await ctx.answerCallbackQuery());
  const result = await confirmTime(groupId, messageId, decodeStarts(ctx.match[1]!)).catch((err) => {
    console.error('confirmTime failed', err);
    return 'error' as const;
  });
  if (result === 'error') {
    return void (await ctx.answerCallbackQuery({ text: 'Hit a snag locking that in. Tap Confirm time again?', show_alert: true }));
  }
  await ctx.answerCallbackQuery({ text: result === 'done' ? 'Time locked!' : 'Already confirmed!' });
  await ctx.editMessageReplyMarkup().catch(() => {});
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
  const before = latestMeeting(groupId);
  if (before?.mode) {
    return void (await ctx.answerCallbackQuery({ text: 'Already sent! Use /meetlink to change the link or place.' }));
  }
  const meeting = await closePoll(groupId);
  if (!meeting) return void (await ctx.answerCallbackQuery({ text: 'Lock a time first.' }));
  const mode = MODES.find((m) => m.key === meeting.mode)?.label ?? 'Meeting';
  await ctx.answerCallbackQuery({ text: `${mode} it is!` });
  // The invite prompt becomes the decision, so the chat reads top to bottom.
  await ctx.editMessageText(`${mode} it is. Sending the invite...`).catch(() => ctx.editMessageReplyMarkup().catch(() => {}));
  await askForMeetingLink(ctx, meeting).catch(async (err) => {
    console.error('Meeting invite failed', err);
    await ctx.reply("Hit a snag sending the invite. Send /meetlink with the link or place to retry.").catch(() => {});
  });
});
