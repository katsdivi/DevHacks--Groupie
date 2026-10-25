import { Composer } from 'grammy';
import { getPending } from '../groups.ts';
import { buildDmContext, voice, type DmContext } from '../context.ts';
import { renderContext } from '../contextPolicy.ts';
import { memoryReply } from '../agent.ts';
import { talk, type ChatMessage } from '../llm.ts';

/**
 * Plain-text conversation in a private chat with the bot. Identity is ctx.from.id; context comes
 * only from buildDmContext (which only calls buildContext). History lives in memory per Telegram
 * user (agent_messages is keyed by member id, and a DM user may be in no group or several).
 */
export const dmComposer = new Composer();

const HISTORY_TURNS = 12;
const histories = new Map<number, ChatMessage[]>();

/** The last turns of this user's DM, oldest first. Never anyone else's. */
export const dmHistory = (userId: number): ChatMessage[] => histories.get(userId) ?? [];

function remember(userId: number, user: string, assistant: string) {
  const next = [...dmHistory(userId), { role: 'user' as const, content: user }, { role: 'assistant' as const, content: assistant }];
  histories.set(userId, next.slice(-HISTORY_TURNS * 2));
}

/** For tests. */
export const clearDmHistory = () => histories.clear();

const nicknameFor = (c: DmContext) => (c.groups.length === 1 ? c.groups[0]!.group!.nickname : 'Groupie');

/** The exact messages a DM sends: the DM context, this user's own DM history, and the new message. */
export function buildDmMessages(c: DmContext, past: ChatMessage[], message: string): ChatMessage[] {
  const nickname = nicknameFor(c);
  const sections = c.groups.length
    ? c.groups.map((g, i) => `GROUP ${i + 1}: ${g.group!.title || 'untitled group'} (you are called ${g.group!.nickname} there)\n${renderContext(g)}`)
    : [
        `They are not in any project group with you yet. Explain warmly what you do: add you to their project group chat and you split the assignment into tasks, find meeting times, and answer questions there; /canvas brings in a Canvas assignment; the Mini App (the button in the group) has their tasks, progress, availability, and a private chat.`,
      ];
  return [
    {
      role: 'system',
      content: `${voice(nickname)}
This is a private Telegram DM with ${c.own.asker.name ?? 'someone'}. Only they see it.
Reply in plain text (no markdown), short: 1 to 4 sentences, or up to 5 "- " lines when listing. Stay in character.
Their private facts are theirs to see. Group facts are what their groups already see. Never talk about a teammate beyond what is in the facts.
To save a fact they can say "remember ..."; to drop one, "forget ...". They can review everything in the Mini App under What ${nickname} remembers.

PRIVATE TO THEM
${renderContext(c.own)}

${sections.join('\n\n')}`,
    },
    ...past,
    { role: 'user', content: message },
  ];
}

/** One DM turn for the verified sender. Memory intents are handled without the model. */
export async function answerDm(userId: number, message: string, now = new Date()): Promise<string> {
  const c = buildDmContext(userId, now);
  const quick = memoryReply(userId, nicknameFor(c), message);
  const answer = quick ?? (await talk(buildDmMessages(c, dmHistory(userId), message), { maxTokens: 500 })).slice(0, 2000);
  remember(userId, message, answer);
  return answer;
}

dmComposer.on('message:text', async (ctx, next) => {
  if (ctx.chat.type !== 'private' || ctx.msg.text.startsWith('/')) return next();
  if (getPending(ctx.chat.id, ctx.from.id)) return next();
  await ctx.replyWithChatAction('typing').catch(() => {});
  try {
    await ctx.reply(await answerDm(ctx.from.id, ctx.msg.text));
  } catch (err) {
    console.error('DM chat failed', err);
    await ctx.reply('My brain is buffering. Try me again in a sec?');
  }
});
