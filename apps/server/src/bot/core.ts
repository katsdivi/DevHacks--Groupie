import { Bot, InlineKeyboard } from 'grammy';
import { encodeStartParam, type Screen } from '@groupie/shared';
import { env } from '../env.ts';

export const bot = new Bot(env.botToken);

/** Direct-link Mini App URL. web_app buttons aren't allowed in groups, so we use plain URL buttons. */
export const appUrl = (groupId: number, screen: Screen) =>
  `https://t.me/${env.botUsername}/${env.miniAppShortName}?startapp=${encodeStartParam(groupId, screen)}`;

export const appButton = (groupId: number, label = 'Open Groupie', screen: Screen = 'home') =>
  new InlineKeyboard().url(label, appUrl(groupId, screen));
