import { InlineKeyboard } from 'grammy';
import { bot } from './core.ts';
import { getGroup, setStatusMessage } from '../groups.ts';
import { askSizeText, sizeHereLabel, TAP_SIZE_ABOVE } from '../copy.ts';

/** Any of these can be tapped; the buttons show 2 to 6 plus the real head count if it is bigger. */
export const TEAM_SIZES = [2, 3, 4, 5, 6, 7, 8];
const BASE_SIZES = [2, 3, 4, 5, 6];
/** Team size the parser plans for when the group has not picked one yet. */
export const DEFAULT_PARSE_SIZE = 4;
/** How many messages up the size buttons can be before "tap above" stops making sense. */
export const SIZE_PROMPT_REACH = 10;

/** People in the chat, not counting Groupie. Null when Telegram will not say. */
export async function peopleInChat(chatId: number): Promise<number | null> {
  try {
    return (await bot.api.getChatMemberCount(chatId)) - 1;
  } catch {
    return null;
  }
}

/** Size buttons: the real head count first (marked), then the usual sizes. */
export function sizeKeyboard(here: number | null) {
  const kb = new InlineKeyboard();
  const hereOk = here !== null && TEAM_SIZES.includes(here);
  if (hereOk) kb.text(sizeHereLabel(here), `size:${here}`).row();
  for (const n of BASE_SIZES) if (!(hereOk && n === here)) kb.text(String(n), `size:${n}`);
  return kb;
}

export const askSizeKeyboard = async (chatId: number) => sizeKeyboard(await peopleInChat(chatId));

/** A size to plan tasks for before the group picks one: the head count if it is a team size, else 4. */
export async function guessTeamSize(chatId: number): Promise<number> {
  const here = await peopleInChat(chatId);
  return here !== null && TEAM_SIZES.includes(here) ? here : DEFAULT_PARSE_SIZE;
}

/**
 * Posts the team size question and remembers it as the group's status message. While the team size
 * is unset, the status message id is the size prompt, so later steps can tell how far up it is.
 */
export async function postSizePrompt(groupId: number) {
  const group = getGroup(groupId);
  if (!group) return;
  const msg = await bot.api.sendMessage(groupId, askSizeText(group.nickname), {
    parse_mode: 'HTML',
    reply_markup: await askSizeKeyboard(groupId),
  });
  setStatusMessage(groupId, msg.message_id);
  return msg;
}

/** True when the size buttons are close enough above `messageId` to point at. */
export function sizePromptNearby(promptId: number | null | undefined, messageId: number): boolean {
  return !!promptId && messageId - promptId <= SIZE_PROMPT_REACH;
}

/**
 * For a group step that needs the team size: "Tap a team size above first." when the buttons are
 * close by, else the buttons again. Call only while the team size is unset.
 */
export async function nudgeTeamSize(groupId: number, messageId: number) {
  const group = getGroup(groupId);
  if (!group) return;
  if (sizePromptNearby(group.statusMessageId, messageId)) {
    await bot.api.sendMessage(groupId, TAP_SIZE_ABOVE, {
      reply_parameters: { message_id: messageId, allow_sending_without_reply: true },
    });
    return;
  }
  await postSizePrompt(groupId);
}
