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
import { featureGuide } from './guide.ts';
import { assignment } from './assignment.ts';
import { maybeRunSplit, splitComposer } from './split.ts';
import { onAvailabilityChanged, scheduleComposer } from './schedule.ts';
import { applyMeetingLink, meetingComposer } from './meeting.ts';
import { checkinComposer } from './checkin.ts';
import { qaComposer } from './qa.ts';
import { dmComposer } from './dm.ts';
import { canvasComposer } from '../canvas/bot.ts';
import { latestMeeting, seedAvailability } from '../availability.ts';
import { meetingSummary } from './meeting.ts';
import { listMembers } from '../members.ts';
import { sendLinkCode } from '../canvas/link.ts';
import { addToGroupUrl, setupStatus } from '../setupStatus.ts';
import { setupCardText, setupKeyboard, SETUP_IMESSAGE } from './setupCard.ts';

import { appButton, appUrl, bot } from './core.ts';
import { postJoinStatus, refreshJoinStatus } from './joinStatus.ts';
import { askSizeKeyboard, nudgeTeamSize, postSizePrompt, sizeKeyboard, TEAM_SIZES } from './teamSize.ts';
import { seedMembers } from '../members.ts';
import { setCanDm } from '../prefs.ts';
import {
  appText,
  askAssignmentText,
  askNameText,
  askSizeText as askSizeCopy,
  BAD_NAME,
  BUTTON,
  GROUP_ONLY,
  groupStateText,
  joinTooEarly,
  KEPT_TOAST,
  namedText,
  REMINDERS_READY,
  renameText,
  RESET_DONE,
  SEED_TOO_EARLY,
  seededText,
  settingsText,
  SIZE_LOCKED,
  START_HELP_LINE,
  sizeSetText,
  sizeToast,
  WELCOME,
  WELCOME_KEPT,
} from '../copy.ts';

export { REMINDERS_READY, renameText };

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


export async function announceRename(groupId: number, name: string) {
  await bot.api.sendMessage(groupId, renameText(name), { parse_mode: 'HTML' });
}

const isGroupChat = (ctx: Context) => ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';

function groupFromCtx(ctx: Context) {
  const chat = ctx.chat!;
  return upsertGroup(chat.id, 'title' in chat ? (chat.title ?? '') : '');
}

/** The fresh-join welcome with [Name me] and [Keep Groupie]. Joining and /reset both send exactly this. */
export const welcomeKeyboard = () => new InlineKeyboard().text(BUTTON.nameMe, 'nick:name').text(BUTTON.keepName, 'nick:keep');

/** Sends the fresh-join welcome to a group. The name is never kept until someone taps. */
export async function sendWelcome(chatId: number) {
  await bot.api.sendMessage(chatId, WELCOME, { reply_markup: welcomeKeyboard() });
}

export { sizeKeyboard, TEAM_SIZES };

const askSizeText = (g: Group) => askSizeCopy(g.nickname);
const askPdfText = (g: Group) => askAssignmentText(g.teamSize ?? 0);

/** Posts the setup prompt and remembers it so later steps can edit it in place. */
async function sendSetupPrompt(ctx: Context) {
  await postSizePrompt(ctx.chat!.id);
}

/** Tasks are in but the team size is not: the one state where a size can still be picked after setup. */
const needsSizeAfterImport = (g: Group) => g.status === 'collecting_members' && !g.teamSize;

/** Setup runs once, right after naming, unless it's already underway. */
async function continueToSetup(ctx: Context) {
  const group = getGroup(ctx.chat!.id);
  if (group && group.status === 'setup' && !group.teamSize) await sendSetupPrompt(ctx);
}

async function askForName(ctx: Context, kind: 'nickname' | 'rename') {
  const user = ctx.from!;
  setPending(ctx.chat!.id, user.id, kind);
  await ctx.reply(askNameText(mention(user.id, user.first_name)), {
    parse_mode: 'HTML',
    reply_markup: { force_reply: true, selective: true, input_field_placeholder: 'Max' },
  });
}

async function applyName(ctx: Context, raw: string, kind: 'nickname' | 'rename') {
  const name = parseNickname(raw);
  if (!name) {
    await ctx.reply(BAD_NAME, {
      reply_parameters: { message_id: ctx.msg!.message_id },
      reply_markup: { force_reply: true, selective: true, input_field_placeholder: 'Max' },
    });
    return;
  }
  clearPending(ctx.chat!.id, ctx.from!.id);
  setNickname(ctx.chat!.id, name);
  await ctx.reply(kind === 'rename' ? renameText(name) : namedText(name), {
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
    await sendWelcome(ctx.chat!.id);
  }
});

bot.on('message:migrate_to_chat_id', (ctx) => {
  migrateGroupId(ctx.chat.id, ctx.msg.migrate_to_chat_id);
});

bot.command('start', async (ctx) => {
  if (!isGroupChat(ctx)) {
    // A DM /start (including the "reminders" deep link) means Telegram now lets us DM them.
    if (ctx.chat?.type === 'private' && ctx.from) setCanDm(ctx.from.id, true);
    if (ctx.match.trim() === 'reminders') {
      await ctx.reply(REMINDERS_READY);
      return;
    }
    // From the Mini App's [Link iMessage]: the same flow as /imessage.
    if (ctx.match.trim() === 'imessage' && ctx.chat?.type === 'private') return void (await sendLinkCode(ctx));
    await replyChecklist(ctx, true);
    return;
  }
  const known = getGroup(ctx.chat.id);
  groupFromCtx(ctx);
  if (!known) await sendWelcome(ctx.chat.id);
  else
    await ctx.reply(featureGuide(known.nickname), {
      parse_mode: 'HTML',
      reply_markup: appButton(ctx.chat.id),
    });
});

/** Opens Telegram's "add to group" picker for this bot. */
const addToGroupButton = () => new InlineKeyboard().url(BUTTON.addToGroup, addToGroupUrl());

/**
 * The personal checklist in a DM, with a button for the next 1 to 3 steps. On /start it also keeps the
 * add-to-group button and points at /help for the full guide.
 */
async function replyChecklist(ctx: Context, fromStart: boolean) {
  const status = setupStatus(ctx.from!.id);
  const kb = setupKeyboard(status);
  const hasAddButton = kb.inline_keyboard.flat().some((b) => 'url' in b && b.url === addToGroupUrl());
  if (fromStart && !hasAddButton) kb.url(BUTTON.addToGroup, addToGroupUrl());
  const text = fromStart ? `${setupCardText(status)}\n\n${html(START_HELP_LINE)}` : setupCardText(status);
  await ctx.reply(text, { parse_mode: 'HTML', ...(kb.inline_keyboard.flat().length ? { reply_markup: kb } : {}) });
}

/** The group's state for /setup once setup is done, with one button for the next step. */
async function replyGroupState(ctx: Context, group: Group) {
  const joined = listMembers(group.id).length;
  const meeting = meetingSummary(group.id, latestMeeting(group.id));
  const text = groupStateText({ nickname: group.nickname, teamSize: group.teamSize, assignmentTitle: group.assignmentTitle, joined, meeting: meeting?.label ?? null });
  const open = group.status === 'collecting_members' && (!group.teamSize || joined < group.teamSize);
  const pickTime = !meeting && (group.status === 'split_ready' || group.status === 'scheduling');
  const button = open ? appButton(group.id, BUTTON.details, 'form') : pickTime ? appButton(group.id, BUTTON.avail, 'avail') : appButton(group.id, BUTTON.open);
  await ctx.reply(text, { parse_mode: 'HTML', reply_markup: button });
}

bot.command('help', async (ctx) => {
  const group = isGroupChat(ctx) ? getGroup(ctx.chat.id) : undefined;
  await ctx.reply(featureGuide(group?.nickname), {
    parse_mode: 'HTML',
    reply_markup: group ? appButton(group.id) : addToGroupButton(),
  });
});


bot.command('app', async (ctx) => {
  if (!isGroupChat(ctx)) return void (await ctx.reply(GROUP_ONLY));
  const group = groupFromCtx(ctx);
  await ctx.reply(appText(group.nickname), {
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
  await ctx.reply(settingsText(group.nickname), {
    parse_mode: 'HTML',
    reply_markup: new InlineKeyboard()
      .text(BUTTON.rename, 'nick:rename')
      .url(BUTTON.settings, appUrl(ctx.chat.id, 'settings')),
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
  await ctx.answerCallbackQuery({ text: KEPT_TOAST });
  groupFromCtx(ctx);
  await ctx
    .editMessageText(WELCOME_KEPT, {
      reply_markup: appButton(ctx.chat!.id),
    })
    .catch(() => {});
  await continueToSetup(ctx);
});

bot.command('setup', async (ctx) => {
  if (ctx.chat?.type === 'private' && ctx.from) {
    // A private message from them means Telegram lets us DM them.
    setCanDm(ctx.from.id, true);
    return void (await replyChecklist(ctx, false));
  }
  if (!isGroupChat(ctx)) return void (await ctx.reply(GROUP_ONLY));
  const group = groupFromCtx(ctx);
  if (needsSizeAfterImport(group)) return void (await postSizePrompt(group.id));
  if (group.status !== 'setup') return void (await replyGroupState(ctx, group));
  await sendSetupPrompt(ctx);
});

bot.callbackQuery(SETUP_IMESSAGE, async (ctx) => {
  await ctx.answerCallbackQuery();
  if (ctx.chat?.type === 'private') await sendLinkCode(ctx);
});

bot.callbackQuery(/^size:(\d)$/, async (ctx) => {
  const group = getGroup(ctx.chat!.id);
  const size = Number(ctx.match[1]);
  if (!group || !TEAM_SIZES.includes(size)) return void (await ctx.answerCallbackQuery());
  if (needsSizeAfterImport(group)) {
    // The task list is already up: lock the size and go straight to joining.
    setTeamSize(group.id, size);
    await ctx.answerCallbackQuery({ text: sizeToast(size) });
    await ctx.editMessageText(sizeSetText(size), { parse_mode: 'HTML' }).catch(() => {});
    await postJoinStatus(group.id);
    await maybeRunSplit(group.id);
    return;
  }
  if (group.status !== 'setup') {
    return void (await ctx.answerCallbackQuery({ text: SIZE_LOCKED, show_alert: true }));
  }
  setTeamSize(group.id, size);
  setStatusMessage(group.id, ctx.callbackQuery.message!.message_id);
  await ctx.answerCallbackQuery({ text: sizeToast(size) });
  await ctx.editMessageText(askPdfText({ ...group, teamSize: size }), {
    parse_mode: 'HTML',
    reply_markup: new InlineKeyboard().text(BUTTON.changeSize, 'size:change'),
  });
});

bot.callbackQuery('size:change', async (ctx) => {
  const group = getGroup(ctx.chat!.id);
  if (!group || group.status !== 'setup') return void (await ctx.answerCallbackQuery());
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(askSizeText(group), { parse_mode: 'HTML', reply_markup: await askSizeKeyboard(group.id) });
});

bot.command('join', async (ctx) => {
  if (!isGroupChat(ctx)) return void (await ctx.reply(GROUP_ONLY));
  const group = groupFromCtx(ctx);
  if (group.status === 'setup') {
    await ctx.reply(joinTooEarly(group.nickname), { parse_mode: 'HTML' });
    return;
  }
  if (!group.teamSize) return void (await nudgeTeamSize(group.id, ctx.msg.message_id));
  await postJoinStatus(group.id);
});

bot.command('seed', async (ctx) => {
  if (!isGroupChat(ctx) || !env.devMode) return;
  const group = groupFromCtx(ctx);
  if (needsSizeAfterImport(group)) return void (await nudgeTeamSize(group.id, ctx.msg.message_id));
  if (group.status === 'setup' || !group.teamSize) {
    await ctx.reply(SEED_TOO_EARLY);
    return;
  }
  const added = seedMembers(group.id, group.teamSize);
  const painted = seedAvailability(group.id);
  await ctx.reply(seededText(added, painted));
  if (added) {
    await refreshJoinStatus(group.id);
    await maybeRunSplit(group.id);
  }
  if (painted) await onAvailabilityChanged(group.id);
});

bot.command('reset', async (ctx) => {
  if (!isGroupChat(ctx) || !env.devMode) return;
  deleteGroup(ctx.chat.id);
  await ctx.reply(RESET_DONE);
  groupFromCtx(ctx);
  await sendWelcome(ctx.chat.id);
});

bot.use(assignment);
bot.filter((ctx) => isGroupChat(ctx)).use(splitComposer);
bot.filter((ctx) => isGroupChat(ctx)).use(scheduleComposer);
bot.filter((ctx) => isGroupChat(ctx)).use(meetingComposer);
bot.filter((ctx) => isGroupChat(ctx)).use(checkinComposer);
bot.use(canvasComposer);

// Capture the reply after [Name me] / [Rename].
bot.on('message:text', async (ctx, next) => {
  if (!isGroupChat(ctx) || ctx.msg.text.startsWith('/')) return next();
  const pending = getPending(ctx.chat.id, ctx.from.id);
  if (!pending) return next();
  if (pending.kind === 'meeting_link') await applyMeetingLink(ctx, ctx.msg.text);
  else await applyName(ctx, ctx.msg.text, pending.kind);
});

// "Max, what's due?" and @mentions: answered last, after every other handler passed.
bot.filter((ctx) => isGroupChat(ctx)).use(qaComposer);
// Plain text in a private chat with the bot: a real reply, last so commands and pending inputs win.
bot.filter((ctx) => ctx.chat?.type === 'private').use(dmComposer);

bot.catch((err) => {
  console.error('Bot error', err.error);
});
