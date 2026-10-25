import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from './llm.ts';

vi.mock('./llm.ts', () => ({
  talk: vi.fn(async (messages: ChatMessage[]) => `ANSWER ${messages.length}`),
}));

// A real file, so a fresh module graph (a "restart") reopens the same database.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'groupie-dm-'));
const file = path.join(dir, 'restart.db');
vi.stubEnv('DATABASE_PATH', file);

afterAll(() => {
  vi.unstubAllEnvs();
  fs.rmSync(dir, { recursive: true, force: true });
});

const USER = 7101;
const OTHER = 7102;

describe('DM history across a restart', () => {
  it('is still there after module state is reset', async () => {
    const before = await import('./bot/dm.ts');
    await before.answerDm(USER, 'RESTART_MARKER hello', new Date('2026-10-26T15:00:00Z'));
    await before.answerDm(OTHER, 'OTHER_MARKER', new Date('2026-10-26T15:00:00Z'));

    expect(fs.existsSync(file)).toBe(true);
    vi.resetModules();
    const { loadDm } = await import('./dmHistory.ts');
    const { answerDm } = await import('./bot/dm.ts');
    const { talk } = await import('./llm.ts');
    expect(loadDm(USER).map((m) => m.content)).toEqual(['RESTART_MARKER hello', 'ANSWER 2']);

    vi.mocked(talk).mockClear();
    await answerDm(USER, 'again', new Date('2026-10-26T15:00:00Z'));
    const sent = vi.mocked(talk).mock.calls.at(-1)![0].map((m) => m.content);
    expect(sent.slice(1)).toEqual(['RESTART_MARKER hello', 'ANSWER 2', 'again']);
    expect(sent.join('\n')).not.toContain('OTHER_MARKER');
  });
});
