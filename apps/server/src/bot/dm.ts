import { Composer, InlineKeyboard } from 'grammy';
import { getPending } from '../groups.ts';
import { buildDmContext, voice, type DmContext } from '../context.ts';
import { renderContext } from '../contextPolicy.ts';
import { memoryReply } from '../agent.ts';
import { talk, type ChatMessage } from '../llm.ts';
import { appendDm, clearMyChat, dmHistoryForAsker } from '../dmHistory.ts';
import { catchWrongApp } from '../canvas/bot.ts';
import { BUTTON, NO_ASSIGNMENT_FILE, pendingGroupLine } from '../copy.ts';
import { projectGroupsFor, type ProjectGroup } from '../membership.ts';
import { appUrl } from './core.ts';
import { groupsWithAssignment, sendAssignment, wantsAssignmentFile } from './assignmentFile.ts';

/**
 * Plain-text conversation in a private chat with the bot. Identity is ctx.from.id; context comes
 * only from buildDmContext (which only calls buildContext). History lives in dm_messages per
 * Telegram user (agent_messages is keyed by member id, and a DM user may be in no group or several),
 * so it survives restarts.
 */
export const dmComposer = new Composer();

/** The reply to /forgetchat. */
export const FORGOT_CHAT = 'Done. Our chat is wiped; your tasks and reminders are untouched.';

const nicknameFor = (c: DmContext) => (c.groups.length === 1 ? c.groups[0]!.group!.nickname : 'Groupie');

/** Groups the sender started (codes or imports) without adding their details, when they joined none. */
export function pendingOnly(userId: number): ProjectGroup[] {
  const all = projectGroupsFor(userId);
  return all.some((g) => g.joined) ? [] : all;
}

/** DM asks about their project, tasks or group, answered with the pending line instead of the model. */
const PROJECT_ASK = /\b(tasks?|groups?|projects?|team|split|status|my part|progress|meetings?|assignment)\b/i;

/**
 * The exact messages a DM sends: the DM context, this user's own DM history, and the new message.
 * `pending` lists groups they started but have no member row in, so the model never says "not in a group".
 */
export function buildDmMessages(c: DmContext, past: ChatMessage[], message: string, pending: string[] = []): ChatMessage[] {
  const nickname = nicknameFor(c);
  const sections = c.groups.length
    ? c.groups.map((g, i) => `GROUP ${i + 1}: ${g.group!.title || 'untitled group'} (you are called ${g.group!.nickname} there)\n${renderContext(g)}`)
    : pending.length
      ? [
          `They are in ${pending.map((t) => t || 'a project group').join(', ')} but haven't added their details yet, so you cannot see their tasks there. Tell them to tap Add my details. Never say they are not in a project group.`,
        ]
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
  const past = dmHistoryForAsker(c.own.asker, userId);
  const quick = memoryReply(userId, nicknameFor(c), message);
  const pending = c.groups.length ? [] : pendingOnly(userId).map((g) => g.group.title);
  const answer = quick ?? (await talk(buildDmMessages(c, past, message, pending), { maxTokens: 500 })).slice(0, 2000);
  appendDm(userId, 'user', message);
  appendDm(userId, 'assistant', answer);
  return answer;
}

// Wipes the sender's DM and Mini App chat history. Identity is ctx.from.id only.
dmComposer.command('forgetchat', async (ctx) => {
  if (ctx.chat.type !== 'private' || !ctx.from) return;
  clearMyChat(ctx.from.id);
  await ctx.reply(FORGOT_CHAT);
});

dmComposer.on('message:text', async (ctx, next) => {
  if (ctx.chat.type !== 'private' || ctx.msg.text.startsWith('/')) return next();
  // The Cubbie import message sent here by mistake: point it at Cubbie, before history or the model.
  if (await catchWrongApp(ctx)) return;
  if (getPending(ctx.chat.id, ctx.from.id)) return next();
  // "Send me the assignment" in a DM: the newest assignment from the sender's own groups.
  if (wantsAssignmentFile(ctx.msg.text)) {
    const [groupId] = groupsWithAssignment(ctx.from.id);
    if (groupId === undefined) return void (await ctx.reply(NO_ASSIGNMENT_FILE));
    return void (await sendAssignment(ctx.chat.id, groupId, ctx.msg.message_id));
  }
  // In a group (made its codes or import) but no member row: say so, with the button, not the model.
  const pending = pendingOnly(ctx.from.id);
  const details = pending.length ? new InlineKeyboard().url(BUTTON.details, appUrl(pending[0]!.group.id, 'form')) : undefined;
  if (pending.length && PROJECT_ASK.test(ctx.msg.text)) {
    return void (await ctx.reply(pendingGroupLine(pending[0]!.group.title), { reply_markup: details }));
  }
  await ctx.replyWithChatAction('typing').catch(() => {});
  try {
    await ctx.reply(await answerDm(ctx.from.id, ctx.msg.text), details ? { reply_markup: details } : {});
  } catch (err) {
    console.error('DM chat failed', err);
    await ctx.reply('My brain is buffering. Try me again in a sec?');
  }
});
