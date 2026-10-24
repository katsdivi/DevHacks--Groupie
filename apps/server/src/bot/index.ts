import { Bot, InlineKeyboard, type Context } from 'grammy';
import { env } from '../env.ts';
import {
  clearPending,
  getGroup,
  getPending,
  migrateGroupId,
  setNickname,
  setPending,
  upsertGroup,
} from '../groups.ts';
import { parseNickname } from './nickname.ts';

export const bot = new Bot(env.botToken);

export const ALLOWED_UPDATES = ['message', 'callback_query', 'my_chat_member', 'poll_answer'] as const;

const html = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const mention = (id: number, name: string) => `<a href="tg://user?id=${id}">${html(name)}</a>`;
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
  await ctx.reply(
    kind === 'rename' ? `New name, who dis. I'm ${html(name)} now.` : `Call me ${html(name)} from now on.`,
    { parse_mode: 'HTML' },
  );
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
  else await ctx.reply(`${html(known.nickname)} here. Already on it.`, { parse_mode: 'HTML' });
});

bot.command('rename', async (ctx) => {
  if (!isGroupChat(ctx)) return;
  groupFromCtx(ctx);
  if (ctx.match.trim()) await applyName(ctx, ctx.match, 'rename');
  else await askForName(ctx, 'rename');
});

bot.command('settings', async (ctx) => {
  if (!isGroupChat(ctx)) return;
  const group = groupFromCtx(ctx);
  await ctx.reply(`<b>Settings</b>\nI go by <b>${html(group.nickname)}</b> in this group.`, {
    parse_mode: 'HTML',
    reply_markup: new InlineKeyboard().text('Rename', 'nick:rename'),
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
    .editMessageText("Hey, I'm Groupie, your group project's biggest fan. Groupie it is, love that for us.")
    .catch(() => {});
});

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
