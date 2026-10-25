import { Router, type Response } from 'express';
import { MemoryCreateRequest, MemoryUpdateRequest, type MemoryItem, type MemoryListResponse } from '@groupie/shared';
import { isGroupMember, linkAuth, tgUser } from '../auth.ts';
import { getGroup } from '../groups.ts';
import { createMemory, deleteMemory, getOwnMemory, listMemory, memoryDto, updateMemory } from '../memory.ts';

/**
 * Step 18a: personal memory for the verified Telegram user (requireAuth already applied by api.ts).
 * The owner is always tgUser(res).id; ids and names in the body are ignored. Rows of someone else
 * answer 404, exactly like rows that do not exist.
 */
export const memoryRouter = Router();

const NOT_FOUND = { error: 'memory_not_found', message: "I don't remember that one." };

/** The verified Telegram user id, or null after sending 401 (browser links cannot use memory). */
function owner(res: Response): number | null {
  const user = linkAuth(res) ? undefined : tgUser(res);
  if (!user?.id) {
    res.status(401).json({ error: 'unauthorized', message: 'Open Groupie from Telegram to see what I remember.' });
    return null;
  }
  return user.id;
}

/** Same checks as api.ts loadGroupFor: the group exists and the caller is in the Telegram chat. */
async function canShareWith(res: Response, userId: number, groupChatId: number | null | undefined): Promise<boolean> {
  if (groupChatId === null || groupChatId === undefined) {
    res.status(400).json({ error: 'group_required', message: 'Pick the group to share this with.' });
    return false;
  }
  if (!getGroup(groupChatId)) {
    res.status(404).json({ error: 'group_not_found', message: "I'm not in that group yet. Add me first!" });
    return false;
  }
  if (!(await isGroupMember(groupChatId, userId))) {
    res.status(403).json({ error: 'not_a_member', message: "You're not in this group, so you can't share with it." });
    return false;
  }
  return true;
}

memoryRouter.get('/me/memory', (_req, res) => {
  const me = owner(res);
  if (me === null) return;
  const body: MemoryListResponse = { items: listMemory(me).map(memoryDto) };
  res.json(body);
});

memoryRouter.post('/me/memory', async (req, res) => {
  const me = owner(res);
  if (me === null) return;
  const parsed = MemoryCreateRequest.safeParse(req.body);
  if (!parsed.success) {
    return void res.status(400).json({ error: 'bad_memory', message: parsed.error.issues[0]?.message ?? 'Check the fact and try again.' });
  }
  const { key, value, visibility, group_chat_id } = parsed.data;
  if (visibility === 'group' && !(await canShareWith(res, me, group_chat_id))) return;
  const body: MemoryItem = memoryDto(createMemory(me, { key, value, source: 'mini_app', visibility, groupChatId: group_chat_id ?? null }));
  res.status(201).json(body);
});

memoryRouter.patch('/me/memory/:id', async (req, res) => {
  const me = owner(res);
  if (me === null) return;
  const row = getOwnMemory(me, Number(req.params.id));
  if (!row) return void res.status(404).json(NOT_FOUND);
  const parsed = MemoryUpdateRequest.safeParse(req.body);
  if (!parsed.success) {
    return void res.status(400).json({ error: 'bad_memory', message: parsed.error.issues[0]?.message ?? 'Check the fact and try again.' });
  }
  const { value, visibility, group_chat_id } = parsed.data;
  const nextVisibility = visibility ?? row.visibility;
  const nextGroup = nextVisibility === 'group' ? (group_chat_id ?? row.groupChatId) : null;
  if (nextVisibility === 'group' && (visibility === 'group' || group_chat_id !== undefined) && !(await canShareWith(res, me, nextGroup))) return;
  const updated = updateMemory(me, row.id, { value, visibility: nextVisibility, groupChatId: nextGroup });
  if (!updated) return void res.status(404).json(NOT_FOUND);
  const body: MemoryItem = memoryDto(updated);
  res.json(body);
});

memoryRouter.delete('/me/memory/:id', (req, res) => {
  const me = owner(res);
  if (me === null) return;
  if (!deleteMemory(me, Number(req.params.id))) return void res.status(404).json(NOT_FOUND);
  res.status(204).end();
});
