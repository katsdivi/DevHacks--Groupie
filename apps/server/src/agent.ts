import { desc, eq } from 'drizzle-orm';
import type { ChatMessage as ChatMessageDto } from '@groupie/shared';
import { db, schema } from './db/index.ts';
import { getGroup, getTasks } from './groups.ts';
import { voice } from './context.ts';
import { buildContext, renderContext, type ContextBuckets } from './contextPolicy.ts';
import { createMemory, forgetMatching, parseMemoryIntent } from './memory.ts';
import { talk, type ChatMessage } from './llm.ts';
import { latestMeeting } from './availability.ts';
import type { Member } from './db/schema.ts';

const { agentMessages } = schema;
const HISTORY_FOR_MODEL = 12;

const dto = (r: typeof agentMessages.$inferSelect): ChatMessageDto => ({
  id: r.id,
  role: r.role,
  content: r.content,
  created_at: r.createdAt,
});

/** This member's private history, oldest first. Never anyone else's. */
export function history(memberId: number, limit = 100): ChatMessageDto[] {
  return db
    .select()
    .from(agentMessages)
    .where(eq(agentMessages.memberId, memberId))
    .orderBy(desc(agentMessages.id))
    .limit(limit)
    .all()
    .reverse()
    .map(dto);
}

function save(memberId: number, role: 'user' | 'assistant', content: string) {
  return dto(db.insert(agentMessages).values({ memberId, role, content, createdAt: new Date().toISOString() }).returning().get());
}

/** Starter prompts that fit where the project is right now. */
export function suggestions(member: Member, groupId: number): string[] {
  const mine = getTasks(groupId).filter((t) => t.assigneeMemberId === member.id && t.status !== 'done');
  const biggest = [...mine].sort((a, b) => b.effort - a.effort)[0];
  const out = ['What should I work on first?'];
  if (biggest) out.push(`Break "${biggest.title}" into steps`);
  out.push(latestMeeting(groupId) ? 'When is our next meeting?' : 'Help me pick good meeting times');
  out.push("Who's stuck and could use help?");
  return out;
}

/** The confirmation after saving a fact from chat. */
export const rememberedLine = (nickname: string) =>
  `Got it, I'll remember that. Only you can see it; you can share it with the group from What ${nickname} remembers.`;

/**
 * The exact messages the private chat sends: private-mode buckets of the asker, their own history
 * (loaded by their member id), and the new message. Nothing else reaches the model.
 */
export function buildChatMessages(b: ContextBuckets, past: Pick<ChatMessageDto, 'role' | 'content'>[], message: string): ChatMessage[] {
  if (b.mode !== 'private') throw new Error('the private chat needs private-mode buckets');
  const name = b.asker.name ?? 'this person';
  return [
    {
      role: 'system',
      content: `${voice(b.group?.nickname ?? 'Groupie')}
This is a private one-on-one chat inside the Groupie Mini App. Only ${name} can see it; their teammates cannot.
Help them plan and get unstuck: suggest which of THEIR OWN open tasks to do first (bigger and blocking ones earlier, deadlines in mind), break their tasks into concrete steps, draft short messages to teammates, and point out the meeting time.
Never tell them to start a task that belongs to someone else. If all their tasks are done, congratulate them and suggest helping a teammate who is stuck (offer, do not take over) or reviewing work before the deadline.
Keep replies under 120 words. You may use **bold** and "- " bullet lines. No headings.
You do not see other people's private chats. You cannot change tasks yourself; tell them to use the Progress screen or the split's Request swap.
If they ask what else they have due (this week, other classes), answer from their own Canvas calendar below. Weigh those deadlines when suggesting what to do first.
To save a fact they can say "remember ..."; to drop one, "forget ...". Remembered facts are listed below.

FACTS
${renderContext(b)}`,
    },
    ...past.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: message },
  ];
}

/** Handles "remember ..." and "forget ..." without the model. Null when the message is neither. */
export function memoryReply(askerId: number, nickname: string, message: string): string | null {
  const intent = parseMemoryIntent(message);
  if (!intent) return null;
  if (intent.kind === 'remember') {
    createMemory(askerId, { key: intent.key, value: intent.value, source: 'chat', visibility: 'private' });
    return rememberedLine(nickname);
  }
  const gone = forgetMatching(askerId, intent.needle);
  if (!gone.length) return `I couldn't find anything like "${intent.needle}" to forget. You can see everything in What ${nickname} remembers.`;
  return `Done, I forgot ${gone.length === 1 ? `"${gone[0]!.value}"` : `${gone.length} things`}.`;
}

/**
 * One turn of the private chat. `member` must come from the verified Telegram id (api.ts looks it
 * up with getMemberByTgUser), so member.tgUserId is the asker's identity.
 */
export async function chatTurn(member: Member, groupId: number, message: string, now = new Date()) {
  const askerId = member.tgUserId;
  if (askerId === null) throw new Error('chat needs a Telegram member');
  const group = getGroup(groupId)!;
  const past = history(member.id, HISTORY_FOR_MODEL);
  const user = save(member.id, 'user', message);
  const quick = memoryReply(askerId, group.nickname, message);
  if (quick) return { user, reply: save(member.id, 'assistant', quick) };
  const b = buildContext({ askerId, groupChatId: groupId, mode: 'private', now });
  const answer = await talk(buildChatMessages(b, past, message), { maxTokens: 900 });
  const reply = save(member.id, 'assistant', answer.slice(0, 4000));
  return { user, reply };
}
