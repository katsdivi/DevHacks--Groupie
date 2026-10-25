import { Composer } from 'grammy';
import { getGroup } from '../groups.ts';
import { groupContext, voice } from '../context.ts';
import { talk } from '../llm.ts';

export const qaComposer = new Composer();

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * If the message is addressed to the bot, returns the question with the address stripped.
 * Addressed = starts with the nickname (then a comma, colon, space, ? or !), mentions the bot,
 * or replies to one of the bot's messages.
 */
export function addressedQuestion(text: string, nickname: string, botUsername: string, replyToBot: boolean): string | null {
  const nick = new RegExp(`^\\s*(hey\\s+|hi\\s+|yo\\s+)?${escapeRe(nickname)}(?=$|[\\s,:?!])[\\s,:!]*`, 'i');
  const mention = new RegExp(`@${escapeRe(botUsername)}\\b`, 'i');
  if (nick.test(text)) return text.replace(nick, '').trim() || 'hi';
  if (mention.test(text)) return text.replace(mention, '').replace(/^[\s,:]+/, '').trim() || 'hi';
  if (replyToBot) return text.trim();
  return null;
}

/** Flood guard: at most 4 questions per person per 30 seconds. Normal use never hits it. */
const recent = new Map<string, number[]>();
const FLOOD_WINDOW_MS = 30_000;
const FLOOD_MAX = 4;

qaComposer.on('message:text', async (ctx, next) => {
  const group = getGroup(ctx.chat.id);
  if (!group || ctx.msg.text.startsWith('/')) return next();
  const replyToBot = ctx.msg.reply_to_message?.from?.id === ctx.me.id;
  const question = addressedQuestion(ctx.msg.text, group.nickname, ctx.me.username, replyToBot);
  if (!question) return next();

  const key = `${group.id}:${ctx.from.id}`;
  const now = Date.now();
  const times = (recent.get(key) ?? []).filter((t) => now - t < FLOOD_WINDOW_MS);
  if (times.length >= FLOOD_MAX) return;
  recent.set(key, [...times, now]);

  await ctx.replyWithChatAction('typing').catch(() => {});
  const reply = (text: string) => ctx.reply(text, { reply_parameters: { message_id: ctx.msg.message_id } });
  try {
    const answer = await talk(
      [
        {
          role: 'system',
          content: `${voice(group.nickname)}
You are answering in the team's group chat, so everyone sees it. Reply in 1 to 3 short sentences, plain text (no markdown, no bullet lists unless listing up to 4 short items), and mention names when useful.
You only know the group facts below. You never see or mention anyone's private chats with you.

GROUP FACTS
${groupContext(group.id)}`,
        },
        { role: 'user', content: `${ctx.from.first_name} asks: ${question}` },
      ],
      { maxTokens: 400, onWait: () => void ctx.replyWithChatAction('typing').catch(() => {}) },
    );
    await reply(answer.slice(0, 1500));
  } catch (err) {
    console.error('group Q&A failed', err);
    await reply(`${group.nickname} here. My brain is buffering. Ask me again in a sec?`);
  }
});
