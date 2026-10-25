import { Router } from 'express';
import { linkAuth, tgUser } from '../auth.ts';
import { clearMyChat } from '../dmHistory.ts';

/** Step 18: "Clear my chat". Mounted on /api by api.ts (requireAuth already applied). */
export const chatRouter = Router();

/** Clears the verified user's bot DM and Mini App chat history. Telegram auth only; any id in the body is ignored. */
chatRouter.delete('/me/chat', (_req, res) => {
  const user = linkAuth(res) ? undefined : tgUser(res);
  if (!user?.id) return void res.status(401).json({ error: 'unauthorized', message: 'Open Groupie from Telegram to clear your chat.' });
  const { dm, app } = clearMyChat(user.id);
  res.json({ ok: true, cleared: { dm, app } });
});
