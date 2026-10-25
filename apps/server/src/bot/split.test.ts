import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

// The card renderer is Chromium; here it either fails or returns a stub PNG, never launches.
const render = vi.hoisted(() => ({ fail: true }));
vi.mock('../cards/render.ts', () => ({
  renderPng: vi.fn(async () => {
    if (render.fail) throw new Error('browser gone');
    return Buffer.from('png');
  }),
  closeRenderer: vi.fn(async () => {}),
}));

const { db, schema } = await import('../db/index.ts');
const { env } = await import('../env.ts');
const { bot } = await import('./core.ts');
const { postSplitCard, splitFallbackText } = await import('./split.ts');
const { computeSplit, splitCardData, splitView } = await import('../splitService.ts');
const { getGroup } = await import('../groups.ts');

type Call = { method: string; payload: Record<string, unknown> };
let calls: Call[] = [];
let msgId = 500;

beforeAll(() => {
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    const chat = { id: (payload as { chat_id?: number }).chat_id ?? 0, type: 'group', title: 'T' };
    const result = method === 'sendMessage' || method === 'sendPhoto' ? { message_id: ++msgId, date: 0, chat } : true;
    return { ok: true, result } as never;
  });
});
afterEach(() => {
  calls = [];
  render.fail = true;
  env.loadAwareSplit = false;
});

const created = new Date().toISOString();
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

/** Divyam opted in and has a heavy week elsewhere, so the load-aware split gives him less. */
const G = -7001;
db.insert(schema.groups).values({ id: G, title: 'Team', tz: 'America/Phoenix', createdAt: created, assignmentTitle: 'Project 2', status: 'split_ready' }).run();
for (const [tg, name, share] of [[71, 'Divyam', true], [72, 'Ava', false], [73, 'Jay', false]] as const) {
  db.insert(schema.members).values({ groupId: G, tgUserId: tg, name, color: '#FFB547', shareWorkload: share, createdAt: created }).run();
}
for (const [title, effort] of [['Interview students', 3], ['Write report', 2], ['Slides', 2], ['Prototype', 3], ['Proofread', 3]] as const) {
  db.insert(schema.tasks).values({ groupId: G, title, effort }).run();
}
for (const d of [1, 2, 3, 4]) {
  db.insert(schema.calendarEvents)
    .values({ telegramUserId: 71, uid: `split-test-${d}`, course: 'HST 101', title: `Reading ${d}`, dueAt: inDays(d), kind: 'assignment', updatedAt: created })
    .run();
}
function assign() {
  for (const [taskId, memberId] of Object.entries(computeSplit(G).assignments)) {
    db.update(schema.tasks).set({ assigneeMemberId: memberId }).where(eq(schema.tasks.id, Number(taskId))).run();
  }
}

const sent = (method: string) => calls.filter((c) => c.method === method);

describe('postSplitCard', () => {
  it('falls back to a text split with the same buttons when the card will not render', async () => {
    env.loadAwareSplit = true;
    assign();
    await postSplitCard(G, '<b>Motu here.</b> Fair split, done.');
    expect(sent('sendChatAction')[0]?.payload.action).toBe('upload_photo');
    expect(sent('sendPhoto')).toHaveLength(0);
    const msg = sent('sendMessage')[0]!;
    const text = String(msg.payload.text);
    expect(text).toContain('<b>Motu here.</b> Fair split, done.');
    expect(text).toContain('<b>Fair split</b> (card is shy today):');
    for (const name of ['Divyam', 'Ava', 'Jay']) expect(text).toContain(`<b>${name}</b>`);
    expect(text).toContain('<b>Divyam</b> <i>(Busy week)</i>');
    expect(text).toContain('Divyam got fewer points this time: busy week.');
    expect(text).not.toContain('HST 101');
    const buttons = JSON.stringify(msg.payload.reply_markup);
    expect(buttons).toContain('split:fair');
    expect(buttons).toContain('Request swap');
    // The text message is the live split, so Looks fair works on it.
    expect(getGroup(G)!.splitMessageId).toBe(msgId);
  });

  it('sends the card as a photo when rendering works', async () => {
    render.fail = false;
    assign();
    await postSplitCard(G, 'Here you go.');
    expect(sent('sendPhoto')).toHaveLength(1);
    expect(sent('sendMessage')).toHaveLength(0);
    expect(getGroup(G)!.splitMessageId).toBe(msgId);
  });
});

describe('splitFallbackText', () => {
  it('escapes names and titles and lists empty members', () => {
    const text = splitFallbackText(
      {
        assignmentTitle: 'P',
        dueLabel: null,
        nickname: 'Motu',
        maxGap: 1,
        members: [
          { name: 'A <b>', color: '#FF6B5B', points: 3, tasks: [{ title: 'X & Y', effort: 3 }] },
          { name: 'Bo', color: '#nope', points: 0, tasks: [] },
        ],
      },
      'Cap',
    );
    expect(text).toContain('<b>A &lt;b&gt;</b>: 3 pts. X &amp; Y');
    expect(text).toContain('<b>Bo</b>: 0 pts. nothing yet');
    expect(text).toContain('Max difference: 1 pt.');
    expect(text).not.toContain('busy week');
  });

  it('matches the card data for a real group', () => {
    assign();
    const data = splitCardData(splitView(G, null));
    const text = splitFallbackText(data, 'Cap');
    for (const m of data.members) expect(text).toContain(`${m.points} pt`);
  });
});
