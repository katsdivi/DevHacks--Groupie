import { InlineKeyboard, type Context } from 'grammy';
import { parseNickname } from '@groupie/shared';
import { env } from '../env.ts';
import {
  clearPending,
  deleteGroup,
  getGroup,
  getPending,
  migrateGroupId,
  setNickname,
  setPending,
  setStatusMessage,
  setTeamSize,
  upsertGroup,
  type Group,
} from '../groups.ts';
import { html } from './format.ts';
import { assignment } from './assignment.ts';
import { maybeRunSplit, splitComposer } from './split.ts';
import { onAvailabilityChanged, scheduleComposer } from './schedule.ts';
import { seedAvailability } from '../availability.ts';

import { appButton, appUrl, bot } from './core.ts';
import { postJoinStatus, refreshJoinStatus } from './joinStatus.ts';
import { seedMembers } from '../members.ts';

export { bot, appUrl };

if (env.devMode) {
  bot.use((ctx, next) => {
    const kind = Object.keys(ctx.update).find((k) => k !== 'update_id');
    const msg = ctx.msg;
    const what = msg?.document ? `document ${msg.document.mime_type}` : msg?.text ? 'text' : (ctx.callbackQuery?.data ?? '');
    console.log(`[update] ${kind} chat=${ctx.chat?.id} ${what}`);
    return next();
  });
}

export const ALLOWED_UPDATES = ['message', 'callback_query', 'my_chat_member', 'poll_answer'] as const;

const mention = (id: number, name: string) => `<a href="tg://user?id=${id}">${html(name)}</a>`;


export const renameText = (name: string) => `New name, who dis. I'm ${html(name)} now.`;

export async function announceRename(groupId: number, name: string) {
  await bot.api.sendMessage(groupId, renameText(name), { parse_mode: 'HTML' });
}

const isGroupChat = (ctx: Context) => ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';

function groupFromCtx(ctx: Context) {
  const chat = ctx.chat!;
  return upsertGroup(chat.id, 'title' in chat ? (chat.title ?? '') : '');
}

async function sendWelcome(ctx: Context) {
  await ctx.reply(
    "Hey, I'm Groupie, your group project's biggest fan. Want to give me a nickname for this group?",
    { reply_markup: new InlineKeyboard().text('Name me', 'nick:name').text('Keep Groupie', 'nick:keep') },
  );
}

const TEAM_SIZES = [3, 4, 5, 6];

const askSizeText = (g: Group) => `<b>${html(g.nickname)} here.</b> How many people are on this project?`;
const askSizeKeyboard = () => {
  const kb = new InlineKeyboard();
  for (const n of TEAM_SIZES) kb.text(String(n), `size:${n}`);
  return kb;
};
const askPdfText = (g: Group) =>
  `<b>Team of ${g.teamSize}.</b> Love that for us.\n\nNow drop the assignment PDF in this chat and I'll turn it into tasks with effort points.`;

/** Posts the setup prompt and remembers it so later steps can edit it in place. */
async function sendSetupPrompt(ctx: Context) {
  const group = getGroup(ctx.chat!.id)!;
  const msg = await ctx.reply(askSizeText(group), { parse_mode: 'HTML', reply_markup: askSizeKeyboard() });
  setStatusMessage(group.id, msg.message_id);
}

/** Setup runs once, right after naming, unless it's already underway. */
async function continueToSetup(ctx: Context) {
  const group = getGroup(ctx.chat!.id);
  if (group && group.status === 'setup' && !group.teamSize) await sendSetupPrompt(ctx);
}

async function askForName(ctx: Context, kind: 'nickname' | 'rename') {
  const user = ctx.from!;
  setPending(ctx.chat!.id, user.id, kind);
  await ctx.reply(`${mention(user.id, user.first_name)}, reply with my new name.`, {
    parse_mode: 'HTML',
    reply_markup: { force_reply: true, selective: true, input_field_placeholder: 'Max' },
  });
}

async function applyName(ctx: Context, raw: string, kind: 'nickname' | 'rename') {
  const name = parseNickname(raw);
  if (!name) {
    await ctx.reply('Hmm, I need 1 to 20 letters, numbers, spaces, or basic punctuation. Try again?', {
      reply_parameters: { message_id: ctx.msg!.message_id },
      reply_markup: { force_reply: true, selective: true, input_field_placeholder: 'Max' },
    });
    return;
  }
  clearPending(ctx.chat!.id, ctx.from!.id);
  setNickname(ctx.chat!.id, name);
  await ctx.reply(kind === 'rename' ? renameText(name) : `Call me ${html(name)} from now on.`, {
    parse_mode: 'HTML',
    reply_markup: appButton(ctx.chat!.id),
  });
  if (kind === 'nickname') await continueToSetup(ctx);
}

// Added to a group (or re-added after being removed).
bot.on('my_chat_member', async (ctx) => {
  if (!isGroupChat(ctx)) return;
  const { old_chat_member: before, new_chat_member: after } = ctx.myChatMember;
  const wasOut = before.status === 'left' || before.status === 'kicked';
  const isIn = after.status === 'member' || after.status === 'administrator';
  if (wasOut && isIn) {
    groupFromCtx(ctx);
    await sendWelcome(ctx);
  }
});

bot.on('message:migrate_to_chat_id', (ctx) => {
  migrateGroupId(ctx.chat.id, ctx.msg.migrate_to_chat_id);
});

bot.command('start', async (ctx) => {
  if (!isGroupChat(ctx)) {
    await ctx.reply("Hey, I'm Groupie, your group project's biggest fan. Add me to your project group chat and I'll take it from there.");
    return;
  }
  const known = getGroup(ctx.chat.id);
  groupFromCtx(ctx);
  if (!known) await sendWelcome(ctx);
  else
    await ctx.reply(`${html(known.nickname)} here. Already on it.`, {
      parse_mode: 'HTML',
      reply_markup: appButton(ctx.chat.id),
    });
});

const GROUP_ONLY = "That one works in your project group chat. Add me there and send it again!";

bot.command('app', async (ctx) => {
  if (!isGroupChat(ctx)) return void (await ctx.reply(GROUP_ONLY));
  const group = groupFromCtx(ctx);
  await ctx.reply(`${html(group.nickname)} here. Tap below to open me.`, {
    parse_mode: 'HTML',
    reply_markup: appButton(ctx.chat.id),
  });
});

bot.command('rename', async (ctx) => {
  if (!isGroupChat(ctx)) return void (await ctx.reply(GROUP_ONLY));
  groupFromCtx(ctx);
  if (ctx.match.trim()) await applyName(ctx, ctx.match, 'rename');
  else await askForName(ctx, 'rename');
});

bot.command('settings', async (ctx) => {
  if (!isGroupChat(ctx)) return void (await ctx.reply(GROUP_ONLY));
  const group = groupFromCtx(ctx);
  await ctx.reply(`<b>Settings</b>\nI go by <b>${html(group.nickname)}</b> in this group.`, {
    parse_mode: 'HTML',
    reply_markup: new InlineKeyboard()
      .text('Rename', 'nick:rename')
      .url('Open settings', appUrl(ctx.chat.id, 'settings')),
  });
});

bot.callbackQuery('nick:name', async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageReplyMarkup().catch(() => {});
  await askForName(ctx, 'nickname');
});

bot.callbackQuery('nick:rename', async (ctx) => {
  await ctx.answerCallbackQuery();
  await askForName(ctx, 'rename');
});

bot.callbackQuery('nick:keep', async (ctx) => {
  await ctx.answerCallbackQuery({ text: 'Groupie it is!' });
  groupFromCtx(ctx);
  await ctx
    .editMessageText("Hey, I'm Groupie, your group project's biggest fan. Groupie it is, love that for us.", {
      reply_markup: appButton(ctx.chat!.id),
    })
    .catch(() => {});
  await continueToSetup(ctx);
});

bot.command('setup', async (ctx) => {
  if (!isGroupChat(ctx)) return void (await ctx.reply(GROUP_ONLY));
  const group = groupFromCtx(ctx);
  if (group.status !== 'setup') {
    await ctx.reply(`${html(group.nickname)} here. We're already set up. Use /reset to start over.`, { parse_mode: 'HTML' });
    return;
  }
  await sendSetupPrompt(ctx);
});

bot.callbackQuery(/^size:(\d)$/, async (ctx) => {
  const group = getGroup(ctx.chat!.id);
  const size = Number(ctx.match[1]);
  if (!group || !TEAM_SIZES.includes(size)) return void (await ctx.answerCallbackQuery());
  if (group.status !== 'setup') {
    return void (await ctx.answerCallbackQuery({ text: "Team's locked in. /reset to start over.", show_alert: true }));
  }
  setTeamSize(group.id, size);
  setStatusMessage(group.id, ctx.callbackQuery.message!.message_id);
  await ctx.answerCallbackQuery({ text: `Team of ${size}!` });
  await ctx.editMessageText(askPdfText({ ...group, teamSize: size }), {
    parse_mode: 'HTML',
    reply_markup: new InlineKeyboard().text('Change team size', 'size:change'),
  });
});

bot.callbackQuery('size:change', async (ctx) => {
  const group = getGroup(ctx.chat!.id);
  if (!group || group.status !== 'setup') return void (await ctx.answerCallbackQuery());
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(askSizeText(group), { parse_mode: 'HTML', reply_markup: askSizeKeyboard() });
});

bot.command('join', async (ctx) => {
  if (!isGroupChat(ctx)) return void (await ctx.reply(GROUP_ONLY));
  const group = groupFromCtx(ctx);
  if (group.status === 'setup') {
    await ctx.reply(`${html(group.nickname)} here. Send the assignment file first, then everyone can join.`, { parse_mode: 'HTML' });
    return;
  }
  await postJoinStatus(group.id);
});

bot.command('seed', async (ctx) => {
  if (!isGroupChat(ctx) || !env.devMode) return;
  const group = groupFromCtx(ctx);
  if (group.status === 'setup' || !group.teamSize) {
    await ctx.reply('Set the team size and send the assignment first, then /seed.');
    return;
  }
  const added = seedMembers(group.id, group.teamSize);
  const painted = seedAvailability(group.id);
  await ctx.reply(
    added || painted
      ? `Added ${added} pretend teammates${painted ? ` and painted free times for ${painted}` : ''}.`
      : 'No empty seats to fill.',
  );
  if (added) {
    await refreshJoinStatus(group.id);
    await maybeRunSplit(group.id);
  }
  if (painted) await onAvailabilityChanged(group.id);
});

bot.command('reset', async (ctx) => {
  if (!isGroupChat(ctx) || !env.devMode) return;
  deleteGroup(ctx.chat.id);
  await ctx.reply('Fresh start. Everything for this group is wiped.');
  groupFromCtx(ctx);
  await sendWelcome(ctx);
});

bot.use(assignment);
bot.filter((ctx) => isGroupChat(ctx)).use(splitComposer);
bot.filter((ctx) => isGroupChat(ctx)).use(scheduleComposer);

// Capture the reply after [Name me] / [Rename].
bot.on('message:text', async (ctx, next) => {
  if (!isGroupChat(ctx) || ctx.msg.text.startsWith('/')) return next();
  const pending = getPending(ctx.chat.id, ctx.from.id);
  if (!pending) return next();
  await applyName(ctx, ctx.msg.text, pending.kind);
});

bot.catch((err) => {
  console.error('Bot error', err.error);
});
