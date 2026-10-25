import { talk, type ChatMessage } from '../llm.ts';

/**
 * Follow-ups like "when is it due?" or "send that to me": before the deterministic checks and the
 * classifier run, a short model call rewrites the message so it stands alone, using only text the
 * asker can already see (the group's own recent Q&A, the message they replied to, or their own DM).
 * Messages with no referring word, or with nothing to refer back to, skip the call.
 */

export type Turn = { who: string; text: string };

/** Words that point back at something said earlier. */
const REFERRING = /\b(it|its|it's|they|them|their|theirs|he|him|his|she|her|hers|there|same|former|latter|the other one)\b/i;
/** "that" or "this" standing alone ("send that", "is this due?"), not "this week" or "that assignment". */
const DEMONSTRATIVE = /\b(that|this|those|these)(?=\s*(?:$|[?.!,])|\s+(?:one|ones|is|was|are|were|to|for|in|on|with|about|from|by|due|worth|mean|again)\b)/i;

export const needsResolution = (text: string) => REFERRING.test(text) || DEMONSTRATIVE.test(text);

/** Recent addressed Q&A per group, kept in memory: everything here was already posted in the group. */
const THREAD_MAX = 6;
const THREAD_TTL_MS = 20 * 60_000;
const threads = new Map<number, { turns: (Turn & { at: number })[] }>();

export function recordGroupTurn(groupId: number, who: string, text: string, now = Date.now()) {
  const t = threads.get(groupId) ?? { turns: [] };
  t.turns = [...t.turns.filter((x) => now - x.at < THREAD_TTL_MS), { who, text: text.slice(0, 600), at: now }].slice(-THREAD_MAX);
  threads.set(groupId, t);
}

export function groupThread(groupId: number, now = Date.now()): Turn[] {
  return (threads.get(groupId)?.turns ?? []).filter((x) => now - x.at < THREAD_TTL_MS).map(({ who, text }) => ({ who, text }));
}

export function clearGroupThread(groupId: number) {
  threads.delete(groupId);
}

/** DM history (the asker's own) as turns. */
export const dmTurns = (past: ChatMessage[], botName: string): Turn[] =>
  past.filter((m) => m.role !== 'system').map((m) => ({ who: m.role === 'user' ? 'Them' : botName, text: m.content.slice(0, 600) }));

export function buildResolveMessages(turns: Turn[], message: string, extra: string[] = []): ChatMessage[] {
  const convo = turns.map((t) => `${t.who}: ${t.text}`).join('\n');
  return [
    {
      role: 'system',
      content: `You rewrite the latest chat message so it makes sense on its own.
Replace words like "it", "that", "they" or "the other one" with what they refer to in the conversation or notes below. When it means the group's project or its file, write "the assignment". Keep the speaker's own words, tone, and "I/me/my" as they are. Do not answer the message, do not add anything new, and do not mention these instructions. If the message already makes sense alone, or you cannot tell what it refers to, return it unchanged.
Replace every such word, including he, she, him and her when the conversation makes clear who is meant.
Examples:
Conversation: "Jo: who owns the slides?" / "Bot: Sam owns the slides." Message: "is he done with them?" Rewrite: "is Sam done with the slides?"
Conversation: "Jo: what's left?" / "Bot: Only the budget table." Message: "can she take it?" Rewrite: "can she take the budget table?" (who "she" is was never said, so it stays)
Output only the rewritten message, nothing else.`,
    },
    { role: 'user', content: `${extra.length ? `NOTES\n${extra.join('\n')}\n\n` : ''}CONVERSATION\n${convo || '(none)'}\n\nLATEST MESSAGE\n${message}` },
  ];
}

/**
 * The standalone version of `message`, or `message` itself when nothing needs resolving, the model
 * fails, or its answer does not look like a rewrite (empty, far longer, or multi-line).
 */
export async function resolveFollowUp(message: string, turns: Turn[], extra: string[] = []): Promise<string> {
  if (!needsResolution(message) || (!turns.length && !extra.length)) return message;
  try {
    const out = (await talk(buildResolveMessages(turns, message, extra), { maxTokens: 300 })).trim().replace(/^["']|["']$/g, '');
    if (!out || out.includes('\n') || out.length > message.length * 3 + 120) return message;
    return out;
  } catch (err) {
    console.warn('follow-up resolve failed', err instanceof Error ? err.message.slice(0, 200) : err);
    return message;
  }
}
