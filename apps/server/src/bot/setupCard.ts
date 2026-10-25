import { InlineKeyboard } from 'grammy';
import type { SetupStatus } from '@groupie/shared';
import { appUrl } from './core.ts';
import { html } from './format.ts';
import { nextSteps } from '../setupStatus.ts';
import { ALL_SET, setupHead, SETUP_MARK } from '../copy.ts';

/** Callback for [Link iMessage] in a DM: runs the same flow as /imessage. */
export const SETUP_IMESSAGE = 'setup:imessage';

/** The checklist as a Telegram HTML message: header, one row per step, and "all set" when nothing is left. */
export function setupCardText(status: SetupStatus): string {
  const rows = status.steps.map((s) => `${s.done ? SETUP_MARK.done : SETUP_MARK.todo} ${html(s.label)}`);
  return [setupHead(status.done, status.total), '', ...rows, ...(status.all_done ? ['', ALL_SET] : [])].join('\n');
}

/** One button per next undone step (1 to 3), each on its own row. Empty when all done. */
export function setupKeyboard(status: SetupStatus): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const s of nextSteps(status)) {
    const a = s.action;
    // A new row before every button after the first, so the markup never ends in an empty row.
    if (kb.inline_keyboard.flat().length) kb.row();
    if (a.kind === 'screen' && status.group) kb.url(s.button, appUrl(status.group.id, a.screen));
    else if (a.kind === 'url') kb.url(s.button, a.url);
    else if (a.kind === 'command' && a.command === 'imessage') kb.text(s.button, SETUP_IMESSAGE);
  }
  return kb;
}

/** Number of buttons in a keyboard (for tests and for skipping an empty markup). */
export const buttonCount = (kb: InlineKeyboard) => kb.inline_keyboard.flat().length;
