import type { NextFunction, Request, Response } from 'express';
import type { LinkPayload, TgUser } from '@groupie/shared';
import { env } from './env.ts';
import { bot } from './bot/core.ts';
import { validateInitData } from './initData.ts';
import { verifyLinkToken } from './linkToken.ts';

/** The verified Telegram user. Only set for `tma` auth; routes that need it must not allow links. */
export const tgUser = (res: Response): TgUser => res.locals.tgUser;
/** The verified browser link, when the request used `link` auth. */
export const linkAuth = (res: Response): LinkPayload | undefined => res.locals.link;

/** Accepts Telegram initData (`tma <initData>`) or a signed browser link (`link <token>`). */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.header('authorization') ?? '';
  if (header.startsWith('tma ')) {
    const user = validateInitData(header.slice(4), env.botToken);
    if (user) {
      res.locals.tgUser = user;
      return next();
    }
  } else if (header.startsWith('link ')) {
    const link = verifyLinkToken(header.slice(5), env.linkSigningSecret);
    if (link) {
      res.locals.link = link;
      return next();
    }
    res.status(401).json({ error: 'link_expired', message: 'This link expired. Ask your group for a fresh one.' });
    return;
  }
  res.status(401).json({ error: 'unauthorized', message: 'Open Groupie from Telegram to continue.' });
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
