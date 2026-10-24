import { Router, type Request, type Response } from 'express';
import { MeResponse, NicknameRequest, parseNickname, type GroupSummary } from '@groupie/shared';
import { isGroupMember, requireTelegram, tgUser } from './auth.ts';
import { getGroup, setNickname, type Group } from './groups.ts';
import { announceRename } from './bot/index.ts';

export const api = Router();
api.use(requireTelegram);

const summary = (g: Group): GroupSummary => ({
  id: g.id,
  title: g.title,
  nickname: g.nickname,
  status: g.status,
  team_size: g.teamSize,
});

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
  const body: MeResponse = { user: tgUser(res), member: null, group: summary(group) };
  res.json(body);
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
