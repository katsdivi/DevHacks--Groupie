import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { env } from '../env.ts';
import { chat, type ChatMessage } from '../llm.ts';
import { cacheKey, lookup, MAX_ENTRIES, normalizePrompt, setCacheFileForTests, store } from './llmCache.ts';

const MODEL = env.chatModel;
const msgs = (today: string, q = 'what is due?'): ChatMessage[] => [
  { role: 'system', content: `You are Motu.\nToday: ${today} (America/Phoenix).\nDue Fri, Oct 31, 4:00 PM. Updated 2026-10-24T17:00:00.000Z.` },
  { role: 'user', content: q },
];
const ok = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
const status = (code: number) => new Response(JSON.stringify({ error: { message: 'nope' } }), { status: code });

let dir: string;
let file: string;
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'groupie-llm-cache-'));
  file = path.join(dir, 'llm-cache.json');
  setCacheFileForTests(file);
  env.demoMode = true;
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  env.demoMode = false;
  setCacheFileForTests(undefined);
  vi.unstubAllGlobals();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('demo LLM cache', () => {
  it('normalizes the today line, ISO timestamps, and clock times', () => {
    const a = msgs('Saturday, Oct 24, 2026, 10:00 AM');
    const b = msgs('Saturday, Oct 24, 2026, 3:17 PM');
    b[0]!.content = b[0]!.content.replace('4:00 PM', '9:30 am').replace('2026-10-24T17:00:00.000Z', '2026-10-24T22:17:05Z');
    expect(cacheKey({ model: MODEL, messages: a })).toBe(cacheKey({ model: MODEL, messages: b }));
    expect(normalizePrompt('Today: Monday, 1:05 PM')).toBe('Today: <today>');
    expect(normalizePrompt('at 4:00 PM on 2026-10-24T17:00:00Z')).toBe('at <time> on <ts>');
    // Different questions or model families do not collide.
    expect(cacheKey({ model: MODEL, messages: a })).not.toBe(cacheKey({ model: MODEL, messages: msgs('x', 'who is stuck?') }));
    expect(cacheKey({ model: MODEL, messages: a })).not.toBe(cacheKey({ model: env.parseModel, messages: a }));
    // The fallback model shares the chat family.
    expect(cacheKey({ model: MODEL, messages: a })).toBe(cacheKey({ model: env.fallbackModel, messages: a }));
  });

  it('stores successes (miss then hit) and serves the cached answer on a later 429', async () => {
    fetchMock.mockResolvedValueOnce(ok('fresh answer'));
    expect(await chat({ model: MODEL, messages: msgs('Sat 10:00 AM') })).toBe('fresh answer');
    expect(lookup(cacheKey({ model: MODEL, messages: msgs('anything') }))).toBe('fresh answer');
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).entries).toBeTypeOf('object');

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce(status(429));
    expect(await chat({ model: MODEL, messages: msgs('Sat 4:45 PM') })).toBe('fresh answer');
    expect(warn.mock.calls.some((c) => String(c[0]).startsWith('[demo-cache] served cached answer for '))).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('serves on 5xx, network error, and timeout; a miss behaves as before', async () => {
    store(cacheKey({ model: MODEL, messages: msgs('x') }), 'saved');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce(status(500));
    expect(await chat({ model: MODEL, messages: msgs('y') })).toBe('saved');
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    expect(await chat({ model: MODEL, messages: msgs('y') })).toBe('saved');
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('timed out'), { name: 'TimeoutError' }));
    expect(await chat({ model: MODEL, messages: msgs('y') })).toBe('saved');
    // Miss: same errors as without the cache.
    fetchMock.mockResolvedValueOnce(status(500));
    await expect(chat({ model: MODEL, messages: msgs('y', 'new question') })).rejects.toThrow('Groq 500: nope');
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(chat({ model: MODEL, messages: msgs('y', 'new question') })).rejects.toThrow('fetch failed');
    // The demo timeout signal is attached.
    expect(fetchMock.mock.calls[0]![1]!.signal).toBeInstanceOf(AbortSignal);
    vi.restoreAllMocks();
  });

  it('is never used when DEMO_MODE is off', async () => {
    store(cacheKey({ model: MODEL, messages: msgs('x') }), 'saved');
    const before = fs.readFileSync(file, 'utf8');
    env.demoMode = false;
    fetchMock.mockResolvedValueOnce(status(500));
    await expect(chat({ model: MODEL, messages: msgs('y') })).rejects.toThrow('Groq 500');
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(chat({ model: MODEL, messages: msgs('y') })).rejects.toThrow('fetch failed');
    fetchMock.mockResolvedValueOnce(ok('not stored'));
    expect(await chat({ model: MODEL, messages: msgs('z', 'other') })).toBe('not stored');
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
    expect(fetchMock.mock.calls.every((c) => c[1]!.signal === undefined)).toBe(true);
  });

  it('caps the file at MAX_ENTRIES, dropping the oldest', () => {
    for (let i = 0; i < MAX_ENTRIES + 5; i++) store(`k${i}`, `v${i}`, new Date(Date.UTC(2026, 0, 1, 0, 0, i)));
    const entries = JSON.parse(fs.readFileSync(file, 'utf8')).entries;
    expect(Object.keys(entries)).toHaveLength(MAX_ENTRIES);
    expect(lookup('k0')).toBeUndefined();
    expect(lookup(`k${MAX_ENTRIES + 4}`)).toBe(`v${MAX_ENTRIES + 4}`);
  });
});
