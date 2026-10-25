import { memoryRouter } from './routes/memory.ts';
import { prefsRouter } from './routes/prefs.ts';
import { calendarRouter } from './routes/calendar.ts';
import { chatRouter } from './routes/chat.ts';
import { Router, type Request, type Response } from 'express';
import {
  MemberRequest,
  NicknameRequest,
  WorkloadRequest,
  SwapRequest,
  AvailabilityPutRequest,
  ChatRequest,
  TaskStatusRequest,
  parseNickname,
  type MeResponse,
  type MemberResponse,
  type WorkloadResponse,
  type SplitResponse,
  type SwapResponse,
  type AvailabilityMeResponse,
  type AvailabilityPutResponse,
  type HeatmapResponse,
  type ChatHistoryResponse,
  type ChatResponse,
  type ProgressResponse,
  type TaskStatusResponse,
} from '@groupie/shared';
import { isGroupMember, linkAuth, requireAuth, tgUser } from './auth.ts';
import { getGroup, getTasks, setNickname, type Group } from './groups.ts';
import { getMemberByTgUser, listMembers, memberDto, setShareWorkload, upsertMember } from './members.ts';
import { refreshJoinStatus } from './bot/joinStatus.ts';
import { maybeRunSplit, postSplitCard } from './bot/split.ts';
import { requestSwap, splitView, SwapError } from './splitService.ts';
import { cleanSlots, getSlots, heatmap, latestMeeting, respondedCount, setSlots } from './availability.ts';
import { meetingSummary } from './bot/meeting.ts';
import { prefillFor } from './busyRead.ts';
import { getTask, progressView, setTaskStatus } from './progress.ts';
import { scheduleProgressCard } from './bot/checkin.ts';
import { chatTurn, history, suggestions } from './agent.ts';
import { onAvailabilityChanged } from './bot/schedule.ts';
import { html } from './bot/format.ts';
import { announceRename } from './bot/index.ts';
import { canvasRouter } from './canvas/routes.ts';

export const api = Router();
api.use(requireAuth);
// Step 18a routers (each agent owns one file).
api.use(memoryRouter);
api.use(prefsRouter);
api.use(calendarRouter);
api.use(canvasRouter);
api.use(chatRouter);

function summary(g: Group): MeResponse['group'] {
  const tasks = getTasks(g.id);
  return {
    id: g.id,
    title: g.title,
    nickname: g.nickname,
    status: g.status,
    team_size: g.teamSize,
    assignment_title: g.assignmentTitle,
    joined: listMembers(g.id).length,
    task_count: tasks.length,
    total_points: tasks.reduce((s, t) => s + t.effort, 0),
    meeting: meetingSummary(g.id, latestMeeting(g.id)),
  };
}

/**
 * Loads the group and checks the caller belongs to it. Sends the error response itself.
 * Browser links only work on routes that pass `allowLink`, and only for their own group.
 */
async function loadGroupFor(req: Request, res: Response, rawId: unknown, allowLink = false): Promise<Group | null> {
  const id = Number(rawId);
  const link = linkAuth(res);
  if (link && (!allowLink || link.g !== id)) {
    res.status(403).json({ error: 'link_scope', message: 'This link only opens availability for its own group.' });
    return null;
  }
  const group = Number.isInteger(id) ? getGroup(id) : undefined;
  if (!group) {
    res.status(404).json({ error: 'group_not_found', message: "I'm not in that group yet. Add me first!" });
    return null;
  }
  if (!link && !(await isGroupMember(group.id, tgUser(res).id))) {
    res.status(403).json({ error: 'not_a_member', message: "You're not in this group, so I can't show it to you." });
    return null;
  }
  return group;
}

/** The caller's member record: from the link, or from their Telegram id. */
function currentMember(res: Response, group: Group) {
  const link = linkAuth(res);
  if (link) return listMembers(group.id).find((m) => m.id === link.m);
  return getMemberByTgUser(group.id, tgUser(res).id);
}

api.get('/me', async (req, res) => {
  const group = await loadGroupFor(req, res, req.query.group);
  if (!group) return;
  const member = getMemberByTgUser(group.id, tgUser(res).id);
  const body: MeResponse = { user: tgUser(res), member: member ? memberDto(member) : null, group: summary(group) };
  res.json(body);
});

api.post('/groups/:id/members', async (req, res) => {
  const group = await loadGroupFor(req, res, req.params.id);
  if (!group) return;
  const parsed = MemberRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'bad_member', message: parsed.error.issues[0]?.message ?? 'Check your details.' });
    return;
  }
  if (group.status === 'setup') {
    res.status(409).json({ error: 'no_assignment', message: "I don't have the assignment yet. Drop it in the group first!" });
    return;
  }
  const userId = tgUser(res).id;
  const already = getMemberByTgUser(group.id, userId);
  const count = listMembers(group.id).length;
  if (!already && group.teamSize && count >= group.teamSize) {
    res.status(409).json({ error: 'team_full', message: `The team is full (${group.teamSize}/${group.teamSize}). Ask someone to bump the team size.` });
    return;
  }
  const member = upsertMember(group.id, userId, parsed.data);
  await refreshJoinStatus(group.id);
  await maybeRunSplit(group.id).catch((err) => console.error('maybeRunSplit failed', err));
  const body: MemberResponse = { member: memberDto(member), joined: listMembers(group.id).length, team_size: group.teamSize ?? 0 };
  res.status(already ? 200 : 201).json(body);
});

api.patch('/groups/:id/nickname', async (req, res) => {
  const group = await loadGroupFor(req, res, req.params.id);
  if (!group) return;
  const parsed = NicknameRequest.safeParse(req.body);
  const nickname = parsed.success ? parseNickname(parsed.data.nickname) : null;
  if (!nickname) {
    res.status(400).json({ error: 'bad_nickname', message: 'Use 1 to 20 letters, numbers, spaces, or basic punctuation.' });
    return;
  }
  if (nickname !== group.nickname) {
    setNickname(group.id, nickname);
    await announceRename(group.id, nickname).catch((err) => console.error('announceRename failed', err));
  }
  res.json({ nickname });
});

/** Opt in or out of the load-aware split. Telegram users only; the caller must have joined. */
api.patch('/groups/:id/members/me/workload', async (req, res) => {
  const group = await loadGroupFor(req, res, req.params.id);
  if (!group) return;
  const parsed = WorkloadRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'bad_workload', message: 'Something went wrong saving that. Try the switch again?' });
    return;
  }
  const me = getMemberByTgUser(group.id, tgUser(res).id);
  if (!me) {
    res.status(409).json({ error: 'not_joined', message: 'Add your details first, then pick this.' });
    return;
  }
  const body: WorkloadResponse = { member: memberDto(setShareWorkload(me.id, parsed.data.shareWorkload)) };
  res.json(body);
});

api.get('/groups/:id/split', async (req, res) => {
  const group = await loadGroupFor(req, res, req.params.id);
  if (!group) return;
  const me = getMemberByTgUser(group.id, tgUser(res).id);
  const body: SplitResponse = splitView(group.id, me?.id ?? null);
  res.json(body);
});

const pts = (n: number) => `${n} pt${n === 1 ? '' : 's'}`;

api.post('/groups/:id/swap', async (req, res) => {
  const group = await loadGroupFor(req, res, req.params.id);
  if (!group) return;
  const parsed = SwapRequest.safeParse(req.body);
  const me = getMemberByTgUser(group.id, tgUser(res).id);
  if (!parsed.success || !me) {
    res.status(400).json({ error: 'bad_swap', message: me ? 'Pick one of your tasks.' : 'Add your details first.' });
    return;
  }
  if (group.status === 'setup' || group.status === 'collecting_members') {
    res.status(409).json({ error: 'no_split', message: 'No split yet. Hang tight until everyone joins.' });
    return;
  }
  try {
    const { result, moved } = requestSwap(group.id, me.id, parsed.data.task_id, parsed.data.to_member_id ?? null);
    const view = splitView(group.id, me.id);
    const task = view.members.flatMap((m) => m.tasks).find((t) => t.id === moved.task_id);
    const to = view.members.find((m) => m.id === moved.to_member_id);
    await postSplitCard(
      group.id,
      `<b>Swap done.</b> ${html(task?.title ?? 'A task')} moved from ${html(me.name)} to ${html(to?.name ?? 'a teammate')}. Max difference: ${pts(result.maxGap)}.`,
    ).catch((err) => console.error('postSplitCard failed', err));
    const body: SwapResponse = { ...view, moved };
    res.json(body);
  } catch (err) {
    if (err instanceof SwapError) {
      res.status(400).json({ error: 'bad_swap', message: err.message });
      return;
    }
    throw err;
  }
});

const NOT_JOINED = { error: 'not_joined', message: 'Add your details first, then paint your free times.' };

api.get('/groups/:id/availability/me', async (req, res) => {
  const group = await loadGroupFor(req, res, req.params.id, true);
  if (!group) return;
  const member = currentMember(res, group);
  if (!member) return void res.status(409).json(NOT_JOINED);
  const body: AvailabilityMeResponse = {
    group: { id: group.id, title: group.title, nickname: group.nickname, tz: group.tz },
    member: { id: member.id, name: member.name, color: member.color },
    slots: getSlots(member.id),
  };
  // Only the caller's own busy data, and only when their member row has a Telegram id with calendar data.
  const prefill = prefillFor(member, group.tz);
  if (prefill) body.prefill = prefill;
  res.json(body);
});

api.put('/groups/:id/availability/me', async (req, res) => {
  const group = await loadGroupFor(req, res, req.params.id, true);
  if (!group) return;
  const member = currentMember(res, group);
  if (!member) return void res.status(409).json(NOT_JOINED);
  const parsed = AvailabilityPutRequest.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: 'bad_slots', message: 'Those times look off. Try again?' });
  const slots = cleanSlots(parsed.data.slots, group.tz);
  setSlots(member.id, slots);
  await onAvailabilityChanged(group.id).catch((err) => console.error('onAvailabilityChanged failed', err));
  const body: AvailabilityPutResponse = {
    saved: slots.length,
    responded: respondedCount(group.id),
    team_size: group.teamSize ?? listMembers(group.id).length,
  };
  res.json(body);
});

api.get('/groups/:id/heatmap', async (req, res) => {
  const group = await loadGroupFor(req, res, req.params.id, true);
  if (!group) return;
  const body: HeatmapResponse = heatmap(group.id);
  res.json(body);
});

api.get('/groups/:id/progress', async (req, res) => {
  const group = await loadGroupFor(req, res, req.params.id);
  if (!group) return;
  const me = getMemberByTgUser(group.id, tgUser(res).id);
  const body: ProgressResponse = progressView(group.id, me?.id ?? null);
  res.json(body);
});

api.patch('/tasks/:id', async (req, res) => {
  const task = getTask(Number(req.params.id));
  if (!task) return void res.status(404).json({ error: 'task_not_found', message: 'That task is gone.' });
  const group = await loadGroupFor(req, res, task.groupId);
  if (!group) return;
  const parsed = TaskStatusRequest.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: 'bad_status', message: 'Pick To do, On track, Stuck, or Done.' });
  const me = getMemberByTgUser(group.id, tgUser(res).id);
  if (!me || task.assigneeMemberId !== me.id) {
    return void res.status(403).json({ error: 'not_your_task', message: "That one isn't yours, so only its owner can update it." });
  }
  setTaskStatus(task.id, parsed.data.status);
  scheduleProgressCard(group.id);
  const progress = progressView(group.id, me.id);
  const updated = progress.members.flatMap((m) => m.tasks).find((t) => t.id === task.id)!;
  const body: TaskStatusResponse = { task: updated, progress };
  res.json(body);
});

api.get('/agent/history', async (req, res) => {
  const group = await loadGroupFor(req, res, req.query.group);
  if (!group) return;
  const me = getMemberByTgUser(group.id, tgUser(res).id);
  if (!me) return void res.status(409).json(NOT_JOINED);
  const body: ChatHistoryResponse = { messages: history(me.id), suggestions: suggestions(me, group.id) };
  res.json(body);
});

api.post('/agent/chat', async (req, res) => {
  const parsed = ChatRequest.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: 'bad_message', message: 'Say something (up to 1000 characters).' });
  const group = await loadGroupFor(req, res, parsed.data.group_id);
  if (!group) return;
  const me = getMemberByTgUser(group.id, tgUser(res).id);
  if (!me) return void res.status(409).json(NOT_JOINED);
  try {
    const body: ChatResponse = await chatTurn(me, group.id, parsed.data.message);
    res.json(body);
  } catch (err) {
    console.error('agent chat failed', err);
    res.status(503).json({ error: 'llm_unavailable', message: `${group.nickname} is thinking too hard. Try again in a few seconds?` });
  }
});
