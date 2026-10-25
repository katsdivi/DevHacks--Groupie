import { Composer, InlineKeyboard, InputFile } from 'grammy';
import { DateTime } from 'luxon';
import { colorEmoji, type TaskStatus } from '@groupie/shared';
import { appUrl, bot } from './core.ts';
import { formatDue, html } from './format.ts';
import { getGroup, getTasks } from '../groups.ts';
import { listMembers } from '../members.ts';
import { getTask, markCheckin, progressView, setTaskStatus } from '../progress.ts';
import { renderPng } from '../cards/render.ts';
import { progressCardHtml, type ProgressCardData } from '../cards/progressCard.ts';
import { db, schema } from '../db/index.ts';
import { weekAheadText } from '../context.ts';
import type { Member } from '../db/schema.ts';

export const checkinComposer = new Composer();

const ICON: Record<TaskStatus, string> = { todo: '⚪', on_track: '👍', stuck: '🆘', done: '✅' };
const STATUS_WORD: Record<TaskStatus, string> = { todo: 'to do', on_track: 'on track', stuck: 'stuck', done: 'done' };
const short = (s: string, n = 28) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function memberCheckin(member: Member, groupId: number) {
  const tasks = getTasks(groupId).filter((t) => t.assigneeMemberId === member.id);
  const text = [
    `${colorEmoji(member.color)} <b>${html(member.name)}</b>`,
    ...tasks.map((t) => `${ICON[t.status as TaskStatus]} ${html(t.title)} · ${t.effort} pt`),
  ].join('\n');
  const kb = new InlineKeyboard();
  for (const t of tasks.filter((x) => x.status !== 'done')) {
    kb.text(`${short(t.title)}`, `ck:${t.id}:info`).row();
    kb.text('✅ Done', `ck:${t.id}:done`).text('👍 On track', `ck:${t.id}:on_track`).text('🆘 Stuck', `ck:${t.id}:stuck`).row();
  }
  return { text, kb, open: tasks.some((t) => t.status !== 'done') };
}

/**
 * Posts the check-in: a header (plus this week's Canvas items for the group's course, when known),
 * then one message per member with buttons for their open tasks.
 */
export async function runCheckin(groupId: number) {
  const group = getGroup(groupId);
  if (!group) return;
  markCheckin(groupId);
  const members = listMembers(groupId);
  const week = weekAheadText(groupId);
  await bot.api.sendMessage(
    groupId,
    `<b>Check-in time!</b> ${html(group.nickname)} here. Tap how each task is going. Only the owner's taps count.${week ? `\n\n${week}` : ''}`,
    { parse_mode: 'HTML' },
  );
  for (const m of members) {
    const { text, kb, open } = memberCheckin(m, groupId);
    if (!open) {
      await bot.api.sendMessage(groupId, `${text}\nAll done. Absolute legend.`, { parse_mode: 'HTML' });
      continue;
    }
    await bot.api.sendMessage(groupId, text, { parse_mode: 'HTML', reply_markup: kb });
  }
}

function progressCardData(groupId: number): ProgressCardData {
  const group = getGroup(groupId)!;
  const p = progressView(groupId, null);
  return {
    assignmentTitle: p.assignment_title ?? group.title,
    dueLabel: formatDue(p.due_date, group.tz),
    daysLeft: p.days_left,
    nickname: group.nickname,
    percent: p.percent,
    donePoints: p.done_points,
    totalPoints: p.total_points,
    members: p.members.map((m) => ({
      name: m.name,
      color: m.color,
      percent: m.percent,
      donePoints: m.done_points,
      points: m.points,
      tasks: m.tasks.map((t) => ({ title: t.title, effort: t.effort, status: t.status })),
    })),
  };
}

export const renderProgressPng = (groupId: number) => renderPng(progressCardHtml(progressCardData(groupId)));
export const progressPreviewHtml = (groupId: number) => progressCardHtml(progressCardData(groupId));

export async function postProgressCard(groupId: number) {
  const group = getGroup(groupId);
  if (!group) return;
  const p = progressView(groupId, null);
  const stuck = p.members.flatMap((m) => m.tasks.filter((t) => t.status === 'stuck').map((t) => `${m.name} on ${t.title}`));
  const when =
    p.days_left === null ? '' : p.days_left < 0 ? `, ${-p.days_left} days overdue` : p.days_left === 0 ? ', due today' : `, ${p.days_left} days left`;
  const caption = [
    `<b>${html(group.nickname)} here.</b> ${p.percent}% done${when}.`,
    ...(stuck.length ? [`Stuck: ${html(stuck.join('; '))}. Someone help a friend out?`] : []),
    ...(p.percent === 100 ? ['Everything is done. I am so proud of you all.'] : []),
  ].join('\n');
  const png = await renderProgressPng(groupId);
  await bot.api.sendPhoto(groupId, new InputFile(png, 'progress.png'), {
    caption,
    parse_mode: 'HTML',
    reply_markup: new InlineKeyboard().url('Update my tasks', appUrl(groupId, 'progress')),
  });
}

const pendingCards = new Map<number, NodeJS.Timeout>();
export const PROGRESS_CARD_DELAY_MS = 6000;

/** Posts a fresh progress card shortly after the last status change, so a burst of taps makes one card. */
export function scheduleProgressCard(groupId: number, delayMs = PROGRESS_CARD_DELAY_MS) {
  clearTimeout(pendingCards.get(groupId));
  pendingCards.set(
    groupId,
    setTimeout(() => {
      pendingCards.delete(groupId);
      postProgressCard(groupId).catch((err) => console.error('postProgressCard failed', err));
    }, delayMs),
  );
}

checkinComposer.command('checkin', async (ctx) => {
  const group = getGroup(ctx.chat.id);
  if (!group || !getTasks(group.id).some((t) => t.assigneeMemberId)) {
    return void (await ctx.reply('Nothing to check in on yet. The split comes first!'));
  }
  await runCheckin(group.id);
});

checkinComposer.command('progress', async (ctx) => {
  const group = getGroup(ctx.chat.id);
  if (!group || !getTasks(group.id).some((t) => t.assigneeMemberId)) {
    return void (await ctx.reply('No progress to show yet. The split comes first!'));
  }
  await ctx.replyWithChatAction('upload_photo').catch(() => {});
  await postProgressCard(group.id);
});

checkinComposer.callbackQuery(/^ck:(\d+):(info|done|on_track|stuck)$/, async (ctx) => {
  const groupId = ctx.chat!.id;
  const task = getTask(Number(ctx.match[1]));
  if (!task || task.groupId !== groupId) return void (await ctx.answerCallbackQuery({ text: 'That task is gone.' }));
  const owner = listMembers(groupId).find((m) => m.id === task.assigneeMemberId);
  if (ctx.match[2] === 'info') {
    return void (await ctx.answerCallbackQuery({ text: `${task.title} (${task.effort} pt), ${STATUS_WORD[task.status as TaskStatus]}`, show_alert: false }));
  }
  if (owner?.tgUserId && owner.tgUserId !== ctx.from.id) {
    return void (await ctx.answerCallbackQuery({ text: `That's ${owner.name}'s task. Nice try!` }));
  }
  const status = ctx.match[2] as TaskStatus;
  setTaskStatus(task.id, status);
  await ctx.answerCallbackQuery({
    text: status === 'done' ? 'Done! Love to see it.' : status === 'stuck' ? "Flagged. I'll ask the team to help." : 'On track. Keep going!',
  });
  if (owner) {
    const { text, kb, open } = memberCheckin(owner, groupId);
    await ctx
      .editMessageText(open ? text : `${text}\nAll done. Absolute legend.`, { parse_mode: 'HTML', reply_markup: open ? kb : undefined })
      .catch(() => {});
  }
  scheduleProgressCard(groupId);
});

/** Weekly check-in: Mondays around 10 AM in the group's time zone, at most once every 6 days. */
export function startWeeklyCheckins(intervalMs = 15 * 60 * 1000) {
  const tick = async () => {
    const groups = db.select().from(schema.groups).all();
    for (const g of groups) {
      if (!['split_ready', 'scheduling', 'active'].includes(g.status)) continue;
      const local = DateTime.now().setZone(g.tz);
      if (local.weekday !== 1 || local.hour !== 10) continue;
      const last = g.lastCheckinAt ? DateTime.fromISO(g.lastCheckinAt) : null;
      if (last && DateTime.now().diff(last, 'days').days < 6) continue;
      await runCheckin(g.id).catch((err) => console.error('weekly check-in failed', g.id, err));
    }
  };
  return setInterval(() => void tick(), intervalMs);
}
