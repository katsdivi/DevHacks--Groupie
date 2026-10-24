import { env } from './env.ts';

const BASE = 'https://api.groq.com/openai/v1';

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

type ChatOpts = {
  model: string;
  messages: ChatMessage[];
  jsonSchema?: { name: string; schema: object };
  /** Use plain JSON mode (for models without strict schema support). */
  jsonObject?: boolean;
  maxTokens?: number;
  temperature?: number;
  reasoningEffort?: 'low' | 'medium' | 'high';
  /** Called once if we hit a rate limit and have to wait. */
  onWait?: () => void;
};

export class LlmError extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Groq chat completion with a short backoff on 429s. Returns the message content. */
export async function chat(opts: ChatOpts): Promise<string> {
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.2,
    max_completion_tokens: opts.maxTokens ?? 2048,
  };
  if (opts.jsonSchema) {
    body.response_format = { type: 'json_schema', json_schema: { ...opts.jsonSchema, strict: true } };
  } else if (opts.jsonObject) {
    body.response_format = { type: 'json_object' };
  }
  if (opts.reasoningEffort) body.reasoning_effort = opts.reasoningEffort;

  let waited = false;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.groqApiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status === 429 || res.status === 503) {
      const retryAfter = Number(res.headers.get('retry-after'));
      const delay = Math.min(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000 * 2 ** attempt, 20_000);
      if (!waited) opts.onWait?.();
      waited = true;
      await sleep(delay);
      continue;
    }
    const json = (await res.json().catch(() => null)) as {
      choices?: { message?: { content?: string } }[];
      error?: { message?: string };
    } | null;
    if (!res.ok) throw new LlmError(`Groq ${res.status}: ${json?.error?.message ?? 'unknown error'}`);
    const content = json?.choices?.[0]?.message?.content;
    if (!content) throw new LlmError('Groq returned an empty message');
    return content;
  }
  throw new LlmError('Groq rate limit did not clear');
}
