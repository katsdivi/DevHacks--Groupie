import { Router, type Request, type Response } from 'express';
import {
  MemberRequest,
  NicknameRequest,
  parseNickname,
  type MeResponse,
  type MemberResponse,
} from '@groupie/shared';
import { isGroupMember, requireTelegram, tgUser } from './auth.ts';
import { getGroup, getTasks, setNickname, type Group } from './groups.ts';
import { getMemberByTgUser, listMembers, memberDto, upsertMember } from './members.ts';
import { refreshJoinStatus } from './bot/joinStatus.ts';
import { announceRename } from './bot/index.ts';

export const api = Router();
api.use(requireTelegram);

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
  };
}

/** Loads the group and checks the caller belongs to it. Sends the error response itself. */
async function loadGroupFor(req: Request, res: Response, rawId: unknown): Promise<Group | null> {
  const id = Number(rawId);
  const group = Number.isInteger(id) ? getGroup(id) : undefined;
  if (!group) {
    res.status(404).json({ error: 'group_not_found', message: "I'm not in that group yet. Add me first!" });
    return null;
  }
  if (!(await isGroupMember(group.id, tgUser(res).id))) {
    res.status(403).json({ error: 'not_a_member', message: "You're not in this group, so I can't show it to you." });
    return null;
  }
  return group;
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
