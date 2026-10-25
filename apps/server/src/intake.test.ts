import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const parse = vi.hoisted(() => ({ fail: false }));
vi.mock('./parse.ts', async (orig) => ({
  ...(await orig<typeof import('./parse.ts')>()),
  parseAssignment: vi.fn(async () => {
    if (parse.fail) throw new Error('model said no');
    return { assignment_title: 'P2', due_date: null, tasks: [{ title: 'Do it', description: '', effort: 3, skill_tags: [] }] };
  }),
}));

const { db, schema } = await import('./db/index.ts');
const { bot } = await import('./bot/core.ts');
const { ingestAssignment } = await import('./intake.ts');

type Call = { method: string; payload: Record<string, unknown> };
let calls: Call[] = [];
let msgId = 900;

beforeAll(() => {
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    const chat = { id: (payload as { chat_id?: number }).chat_id ?? 0, type: 'group', title: 'T' };
    return { ok: true, result: method === 'sendMessage' ? { message_id: ++msgId, date: 0, chat } : true } as never;
  });
});
afterEach(() => {
  calls = [];
  parse.fail = false;
});

let nextGroup = -8000;
function makeGroup() {
  const id = nextGroup--;
  db.insert(schema.groups).values({ id, title: 'Team', tz: 'America/Phoenix', createdAt: new Date().toISOString(), teamSize: 2, status: 'setup' }).run();
  return id;
}
const edits = () => calls.filter((c) => c.method === 'editMessageText').map((c) => String(c.payload.text));
const LONG = 'Build a campus food finder app with search, hours, and a map. '.repeat(3);

describe('ingestAssignment failure copy', () => {
  it('a thin Canvas import suggests dropping the PDF, in the group and in the Mini App', async () => {
    const r = await ingestAssignment(makeGroup(), { text: 'tiny', sourceLabel: 'Project 2', source: 'canvas' });
    expect(r).toMatchObject({ ok: false, reason: 'too_short' });
    expect(!r.ok && r.message).toContain('PDF');
    expect(edits().at(-1)).toContain("Canvas didn't give me much text for <b>Project 2</b>");
  });

  it('a failed Canvas import points to a fresh code', async () => {
    parse.fail = true;
    const r = await ingestAssignment(makeGroup(), { text: LONG, sourceLabel: 'Project 2', source: 'canvas' });
    expect(r).toMatchObject({ ok: false, reason: 'failed' });
    expect(!r.ok && r.message).toContain('new code');
    expect(edits().at(-1)).toContain('Send /canvas for a fresh code');
  });

  it('a failed file upload keeps the resend hint', async () => {
    parse.fail = true;
    await ingestAssignment(makeGroup(), { text: LONG, sourceLabel: 'p2.pdf' });
    expect(edits().at(-1)).toBe("I couldn't make sense of that one. Try sending it again, or as a PDF?");
  });

  it('edits the Reading message into the task list on success', async () => {
    const r = await ingestAssignment(makeGroup(), { text: LONG, sourceLabel: 'Project 2', source: 'canvas' });
    expect(r.ok).toBe(true);
    const reading = calls.find((c) => c.method === 'sendMessage')!;
    expect(String(reading.payload.text)).toBe('Reading <b>Project 2</b>. Give me a sec...');
    expect(edits().some((t) => t.startsWith('<b>Got it: P2</b>'))).toBe(true);
  });
});
