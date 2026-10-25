import { desc, eq } from 'drizzle-orm';
import type { ChatMessage as ChatMessageDto } from '@groupie/shared';
import { db, schema } from './db/index.ts';
import { getGroup, getTasks } from './groups.ts';
import { groupContext, memberContext, voice } from './context.ts';
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

/** One turn of the private chat: saves the question, asks the model with this member's context, saves the reply. */
export async function chatTurn(member: Member, groupId: number, message: string) {
  const group = getGroup(groupId)!;
  const past = history(member.id, HISTORY_FOR_MODEL);
  const user = save(member.id, 'user', message);
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `${voice(group.nickname)}
This is a private one-on-one chat inside the Groupie Mini App. Only ${member.name} can see it; their teammates cannot.
Help them plan and get unstuck: suggest which of THEIR OWN open tasks to do first (bigger and blocking ones earlier, deadlines in mind), break their tasks into concrete steps, draft short messages to teammates, and point out the meeting time.
Never tell them to start a task that belongs to someone else. If all their tasks are done, congratulate them and suggest helping a teammate who is stuck (offer, do not take over) or reviewing work before the deadline.
Keep replies under 120 words. You may use **bold** and "- " bullet lines. No headings.
You do not see other people's private chats. You cannot change tasks yourself; tell them to use the Progress screen or the split's Request swap.

${memberContext(member, groupId)}

GROUP FACTS
${groupContext(groupId)}`,
    },
    ...past.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: message },
  ];
  const answer = await talk(messages, { maxTokens: 900 });
  const reply = save(member.id, 'assistant', answer.slice(0, 4000));
  return { user, reply };
}
