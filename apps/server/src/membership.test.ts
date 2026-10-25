import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Update } from 'grammy/types';

// The DM model is mocked: the pending-group answer must not reach it.
vi.mock('./llm.ts', async (orig) => ({ ...(await orig<typeof import('./llm.ts')>()), talk: vi.fn(async () => 'MODEL ANSWER') }));
vi.mock('./cards/render.ts', () => ({
  renderPng: vi.fn(async () => {
    throw new Error('no browser in tests');
  }),
  closeRenderer: vi.fn(async () => {}),
}));

const { talk } = await import('./llm.ts');
const { db, schema } = await import('./db/index.ts');
const { bot } = await import('./bot/index.ts');
const { appUrl } = await import('./bot/core.ts');
const { createPairCode } = await import('./canvas/pairCodes.ts');
const { meView } = await import('./canvas/link.ts');
const { isLinked, projectGroupsFor } = await import('./membership.ts');
const copy = await import('./copy.ts');

type Call = { method: string; payload: Record<string, unknown> };
let calls: Call[] = [];
let msgId = 100;

beforeAll(() => {
  bot.botInfo = {
    id: 1,
    is_bot: true,
    first_name: 'Groupie',
    username: 'CubbieGroupieBot',
    can_join_groups: true,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
    can_connect_to_business: false,
    has_main_web_app: false,
    has_topics_enabled: false,
    allows_users_to_create_topics: false,
  } as typeof bot.botInfo;
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    const chatId = (payload as { chat_id?: number }).chat_id ?? 0;
    const result = method === 'sendMessage' ? { message_id: ++msgId, date: 0, chat: { id: chatId, type: 'private' } } : true;
    return { ok: true, result } as never;
  });
});
afterEach(() => {
  calls = [];
  vi.mocked(talk).mockClear();
});

const iso = new Date().toISOString();
let nextGroup = -7700;
function makeGroup(title: string) {
  const id = nextGroup--;
  db.insert(schema.groups).values({ id, title, tz: 'America/Phoenix', createdAt: iso, assignmentTitle: 'Sprint 3' }).run();
  return id;
}
const member = (groupId: number, tgUserId: number, name: string) =>
  db.insert(schema.members).values({ groupId, tgUserId, name, color: '#FF6B5B', createdAt: iso }).returning().get();

let updateId = 1;
const dm = (userId: number, text: string) =>
  bot.handleUpdate({
    update_id: updateId++,
    message: { message_id: ++msgId, date: 0, chat: { id: userId, type: 'private', first_name: 'Ana' }, from: { id: userId, is_bot: false, first_name: 'Ana' }, text },
  } as Update);
const last = () => calls.filter((c) => c.method === 'sendMessage').at(-1)!;
const buttons = (c: Call) => ((c.payload.reply_markup as { inline_keyboard?: { text: string; url?: string }[][] })?.inline_keyboard ?? []).flat();

describe('projectGroupsFor and isLinked', () => {
  it('lists joined groups first, then groups with a code or import but no member row', () => {
    const U = 8101;
    const joined = makeGroup('Joined Team');
    const coded = makeGroup('Coded Team');
    const imported = makeGroup('Imported Team');
    const stranger = makeGroup('Not Mine');
    member(joined, U, 'Ana');
    createPairCode(U, coded);
    createPairCode(U, joined);
    createPairCode(8199, stranger);
    db.insert(schema.cubbieImports).values({ telegramUserId: U, groupChatId: imported, payload: {}, createdAt: iso }).run();
    const got = projectGroupsFor(U).map((g) => [g.group.title, g.joined]);
    expect(got[0]).toEqual(['Joined Team', true]);
    expect(got.slice(1).sort()).toEqual([
      ['Coded Team', false],
      ['Imported Team', false],
    ]);
  });
  it('ignores link codes and revoked links', () => {
    const U = 8102;
    createPairCode(U, makeGroup('Link only'), new Date(), undefined, 'link');
    expect(projectGroupsFor(U)).toEqual([]);
    db.insert(schema.cubbieLinks).values({ telegramUserId: U, tokenHash: 'rev-8102', createdAt: iso, revokedAt: iso }).run();
    expect(isLinked(U)).toBe(false);
    db.insert(schema.cubbieLinks).values({ telegramUserId: U, tokenHash: 'live-8102', createdAt: iso }).run();
    expect(isLinked(U)).toBe(true);
  });
});

describe('membership regression: codes but no member row', () => {
  it('Groupie status (meView) says "You\'re in <group>" instead of nothing', () => {
    const U = 8201;
    const G = makeGroup('Capstone Team');
    createPairCode(U, G);
    const me = meView(U);
    expect(me.groups.map((g) => g.title)).toEqual(['Capstone Team']);
    expect(me.groups[0]!.myTasks).toEqual([]);
    expect(me.summary).toContain(copy.pendingGroupLine('Capstone Team'));
  });

  it('a DM about tasks gets the pending line and Add my details, never the model', async () => {
    const U = 8202;
    const G = makeGroup('Capstone Team');
    createPairCode(U, G);
    await dm(U, 'what are my tasks?');
    expect(talk).not.toHaveBeenCalled();
    const r = last();
    expect(r.payload.text).toBe(copy.pendingGroupLine('Capstone Team'));
    expect(String(r.payload.text)).not.toMatch(/not in (a|any) project group/i);
    expect(buttons(r)).toEqual([{ text: copy.BUTTON.details, url: appUrl(G, 'form') }]);
  });

  it('other DM chat still uses the model, told about the pending group, with the button', async () => {
    const U = 8203;
    const G = makeGroup('Capstone Team');
    createPairCode(U, G);
    await dm(U, 'hey there');
    expect(talk).toHaveBeenCalledTimes(1);
    const system = vi.mocked(talk).mock.calls[0]![0][0]!.content;
    expect(system).toContain("They are in Capstone Team but haven't added their details yet");
    expect(system).not.toContain('They are not in any project group');
    expect(buttons(last())[0]!.url).toBe(appUrl(G, 'form'));
  });

  it('a member gets their tasks (meView and the DM model context)', async () => {
    const U = 8204;
    const G = makeGroup('Member Team');
    const m = member(G, U, 'Ana');
    db.insert(schema.tasks).values({ groupId: G, title: 'Write the report', effort: 3, assigneeMemberId: m.id }).run();
    const me = meView(U);
    expect(me.groups[0]!.myTasks).toEqual([{ title: 'Write the report', status: 'todo', points: 3 }]);
    expect(me.summary).not.toContain("haven't added");
    await dm(U, 'what are my tasks?');
    expect(talk).toHaveBeenCalledTimes(1);
    expect(vi.mocked(talk).mock.calls[0]![0][0]!.content).toContain('Write the report');
    expect(buttons(last())).toEqual([]);
  });
});
