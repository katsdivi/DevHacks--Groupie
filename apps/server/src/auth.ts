import type { NextFunction, Request, Response } from 'express';
import type { TgUser } from '@groupie/shared';
import { env } from './env.ts';
import { bot } from './bot/core.ts';
import { validateInitData } from './initData.ts';

/** The verified Telegram user, set by requireTelegram. */
export const tgUser = (res: Response): TgUser => res.locals.tgUser;

export function requireTelegram(req: Request, res: Response, next: NextFunction) {
  const header = req.header('authorization') ?? '';
  const user = header.startsWith('tma ') ? validateInitData(header.slice(4), env.botToken) : null;
  if (!user) {
    res.status(401).json({ error: 'unauthorized', message: 'Open Groupie from Telegram to continue.' });
    return;
  }
  res.locals.tgUser = user;
  next();
}

const MEMBER_TTL_MS = 5 * 60 * 1000;
const memberCache = new Map<string, { ok: boolean; until: number }>();

export async function isGroupMember(groupId: number, userId: number): Promise<boolean> {
  const key = `${groupId}:${userId}`;
  const hit = memberCache.get(key);
  if (hit && hit.until > Date.now()) return hit.ok;
  let ok: boolean;
  try {
    const m = await bot.api.getChatMember(groupId, userId);
    ok = ['creator', 'administrator', 'member'].includes(m.status) || (m.status === 'restricted' && m.is_member);
  } catch {
    ok = false;
  }
  memberCache.set(key, { ok, until: Date.now() + (ok ? MEMBER_TTL_MS : 30_000) });
  return ok;
}
