import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { env } from '../env.ts';

/**
 * Demo safety net for llm.ts. Only active when DEMO_MODE=true. Successful answers are stored by a
 * sha256 of the normalized request; when Groq fails (429, 5xx, network, timeout) llm.ts serves the
 * stored answer instead. The cache is a JSON file next to the database so a separate `warm` process
 * and the live server share it: every lookup reads the file, every store is read-merge-write.
 */

export const DEMO_TIMEOUT_MS = 12_000;
export const MAX_ENTRIES = 500;

type Entry = { content: string; savedAt: string };
type CacheFile = { version: 1; entries: Record<string, Entry> };

type KeyInput = { model: string; messages: { role: string; content: string }[]; format?: string };

let fileOverride: string | null | undefined;
const memory = new Map<string, Entry>();

/** True when the demo cache is on. Read on every call so tests can flip it. */
export const demoCacheOn = () => env.demoMode;

/** Tests: point the cache at a file, or null for memory only. Undefined restores the default. */
export function setCacheFileForTests(file: string | null | undefined) {
  fileOverride = file;
  memory.clear();
}

/** `<dirname(DATABASE_PATH)>/llm-cache.json`, or null (memory only) for an in-memory database. */
export function cacheFile(): string | null {
  if (fileOverride !== undefined) return fileOverride;
  if (env.databasePath === ':memory:') return null;
  return path.join(path.dirname(path.resolve(env.databasePath)), 'llm-cache.json');
}

/** Replaces the volatile parts of a prompt (today line, ISO timestamps, clock times) with placeholders. */
export function normalizePrompt(text: string): string {
  return text
    .replace(/^Today(:| is) .*$/gim, 'Today: <today>')
    .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?/g, '<ts>')
    .replace(/\b\d{1,2}:\d{2}\s?[AaPp]\.?[Mm]\.?/g, '<time>');
}

/** Groups models so a fallback model can serve the main model's answer: 'parse' or 'chat'. */
export const modelFamily = (model: string) => (model === env.parseModel ? 'parse' : 'chat');

/** sha256 hex of the model family, response format, and normalized messages. */
export function cacheKey(req: KeyInput): string {
  const normalized = {
    family: modelFamily(req.model),
    format: req.format ?? 'text',
    messages: req.messages.map((m) => ({ role: m.role, content: normalizePrompt(m.content) })),
  };
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

/**
 * A looser key for when the facts changed since warm (a live import parsed slightly differently, a
 * task moved): the instructions part of the first message (up to the first blank line, before the
 * facts) and the last message. Served only after a Groq failure and an exact-key miss.
 */
export function looseKey(req: KeyInput): string {
  const first = req.messages[0]?.content ?? '';
  const loose = {
    family: modelFamily(req.model),
    format: req.format ?? 'text',
    head: normalizePrompt(first.split('\n\n')[0] ?? ''),
    last: normalizePrompt(req.messages.at(-1)?.content ?? ''),
  };
  return `loose:${createHash('sha256').update(JSON.stringify(loose)).digest('hex')}`;
}

export const shortKey = (key: string) => key.slice(0, 10);

function readFile(file: string): Record<string, Entry> {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as CacheFile;
    return parsed && typeof parsed.entries === 'object' && parsed.entries ? parsed.entries : {};
  } catch {
    return {};
  }
}

/** Keeps the newest MAX_ENTRIES by savedAt. */
function cap(entries: Record<string, Entry>): Record<string, Entry> {
  const list = Object.entries(entries);
  if (list.length <= MAX_ENTRIES) return entries;
  list.sort((a, b) => b[1].savedAt.localeCompare(a[1].savedAt));
  return Object.fromEntries(list.slice(0, MAX_ENTRIES));
}

/** The cached answer for this key, if any. */
export function lookup(key: string): string | undefined {
  const file = cacheFile();
  if (!file) return memory.get(key)?.content;
  return readFile(file)[key]?.content;
}

/** Stores an answer, merging with what other processes wrote, then writes atomically (tmp + rename). */
export function store(key: string, content: string, now = new Date(), loose?: string) {
  const entry = { content, savedAt: now.toISOString() };
  const keys = loose ? [key, loose] : [key];
  const file = cacheFile();
  if (!file) {
    for (const k of keys) {
      memory.delete(k);
      memory.set(k, entry);
    }
    while (memory.size > MAX_ENTRIES) memory.delete(memory.keys().next().value!);
    return;
  }
  try {
    const entries = cap({ ...readFile(file), ...Object.fromEntries(keys.map((k) => [k, entry])) });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, entries } satisfies CacheFile));
    fs.renameSync(tmp, file);
  } catch (err) {
    console.warn('[demo-cache] could not write cache:', err instanceof Error ? err.message : err);
  }
}

/** Number of stored entries (for warm's summary). */
export function cacheSize(): number {
  const file = cacheFile();
  return file ? Object.keys(readFile(file)).length : memory.size;
}

/** Serves a cached answer after a failure, logging it. Undefined when nothing is cached. */
export function serveCached(key: string, why: string, loose?: string): string | undefined {
  const hit = lookup(key);
  if (hit !== undefined) {
    console.warn(`[demo-cache] served cached answer for ${shortKey(key)} (${why})`);
    return hit;
  }
  const near = loose ? lookup(loose) : undefined;
  if (near !== undefined) console.warn(`[demo-cache] served nearest cached answer for ${shortKey(key)} (${why})`);
  return near;
}
