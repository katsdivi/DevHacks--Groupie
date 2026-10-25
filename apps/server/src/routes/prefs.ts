import { Router } from 'express';
import { tgUser } from '../auth.ts';
import { getPrefs, parsePrefsUpdate, prefsDto, updatePrefs } from '../prefs.ts';

/** Step 18a: Telegram-auth routes for prefs. Mounted on /api by api.ts (requireAuth already applied). */
export const prefsRouter = Router();

/** The verified user's reminder prefs (defaults created on first read). */
prefsRouter.get('/me/prefs', (_req, res) => {
  res.json(prefsDto(getPrefs(tgUser(res).id)));
});

/** Saves reminder prefs for the verified user only; any user id in the body is ignored. */
prefsRouter.put('/me/prefs', (req, res) => {
  const result = parsePrefsUpdate(req.body);
  if (!result.ok) return void res.status(400).json({ error: 'bad_prefs', message: result.message });
  res.json(prefsDto(updatePrefs(tgUser(res).id, result.patch)));
});
