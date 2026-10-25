import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Update } from 'grammy/types';

// No model and no browser in these tests: the parser returns a fixed plan, the chat model must not run.
vi.mock('../llm.ts', async (orig) => ({ ...(await orig<typeof import('../llm.ts')>()), talk: vi.fn(async () => 'MODEL ANSWER') }));
vi.mock('../parse.ts', async (orig) => ({
  ...(await orig<typeof import('../parse.ts')>()),
  parseAssignment: vi.fn(async () => ({
    assignment_title: 'P2',
    due_date: null,
    tasks: [
      { title: 'Research', description: '', effort: 3, skill_tags: [] },
      { title: 'Slides', description: '', effort: 2, skill_tags: [] },
    ],
  })),
}));
vi.mock('../cards/render.ts', () => ({
  renderPng: vi.fn(async () => {
    throw new Error('no browser in tests');
  }),
  closeRenderer: vi.fn(async () => {}),
}));
vi.mock('../auth.ts', async (orig) => ({ ...(await orig<typeof import('../auth.ts')>()), isGroupMember: vi.fn(async () => true) }));

const { PAIR_CODE_TTL_MS } = await import('@groupie/shared');
const { talk } = await import('../llm.ts');
const { parseAssignment } = await import('../parse.ts');
const { db, schema } = await import('../db/index.ts');
const { env } = await import('../env.ts');
const { bot } = await import('./index.ts');
const { getGroup } = await import('../groups.ts');
const { ingestAssignment } = await import('../intake.ts');
const { claimPairCode, createPairCode, getPairCode } = await import('../canvas/pairCodes.ts');
const { canvasCodeText, matchWrongApp } = await import('../canvas/bot.ts');
const { startTestApp } = await import('../canvas/testApp.ts');
const copy = await import('../copy.ts');

type Call = { method: string; payload: Record<string, unknown> };
let calls: Call[] = [];
let msgId = 1000;

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
    const chat = { id: chatId, type: chatId < 0 ? 'group' : 'private', title: 'T' };
    let result: unknown = true;
    if (method === 'sendMessage' || method === 'sendPhoto') result = { message_id: ++msgId, date: 0, chat };
    if (method === 'getChatMemberCount') result = 4;
    return { ok: true, result } as never;
  });
});
afterEach(() => {
  calls = [];
  vi.mocked(talk).mockClear();
  env.devMode = false;
});

const sent = () => calls.filter((c) => c.method === 'sendMessage');
const lastSent = () => sent().at(-1)!;
const markup = (c: Call) => JSON.stringify(c.payload.reply_markup ?? null);
const codeIn = (text: string) => /Groupie import ([A-Z0-9]{6})/.exec(text)?.[1];
const created = new Date().toISOString();

let nextGroup = -9100;
function makeGroup(fields: Partial<typeof schema.groups.$inferInsert> = {}) {
  const id = nextGroup--;
  db.insert(schema.groups).values({ id, title: 'Team', tz: 'America/Phoenix', createdAt: created, ...fields }).run();
  return id;
}

let updateId = 1;
const user = (id: number) => ({ id, is_bot: false, first_name: 'Ana' });
function textUpdate(chatId: number, fromId: number, text: string, messageId = ++msgId): Update {
  const chat = chatId < 0 ? { id: chatId, type: 'group' as const, title: 'Team' } : { id: chatId, type: 'private' as const, first_name: 'Ana' };
  const command = /^\/\w+/.exec(text);
  return {
    update_id: updateId++,
    message: {
      message_id: messageId,
      date: 0,
      chat,
      from: user(fromId),
      text,
      ...(command ? { entities: [{ type: 'bot_command' as const, offset: 0, length: command[0].length }] } : {}),
    },
  } as Update;
}
const send = (chatId: number, fromId: number, text: string, messageId?: number) => bot.handleUpdate(textUpdate(chatId, fromId, text, messageId));
const tap = (chatId: number, fromId: number, data: string, messageId: number) =>
  bot.handleUpdate({
    update_id: updateId++,
    callback_query: {
      id: String(updateId),
      from: user(fromId),
      chat_instance: 'x',
      data,
      message: { message_id: messageId, date: 0, chat: { id: chatId, type: 'group', title: 'Team' } },
    },
  } as Update);

describe('wrong-app matcher', () => {
  it('matches the Cubbie import message with or without assignment words', () => {
    expect(matchWrongApp('Groupie import K7Q2MX')).toEqual({ code: 'K7Q2MX', rest: '' });
    expect(matchWrongApp('  groupie IMPORT k7q2mx  Project 2   final ')).toEqual({ code: 'K7Q2MX', rest: 'Project 2 final' });
  });
  it('ignores other messages', () => {
    expect(matchWrongApp('Groupie, what is due?')).toBeNull();
    expect(matchWrongApp('Groupie import K7Q2')).toBeNull();
    expect(matchWrongApp('Groupie import K7Q2MXX')).toBeNull();
    expect(matchWrongApp('please Groupie import K7Q2MX')).toBeNull();
  });
});

describe('wrong-app catch in a DM', () => {
  const ME = 6101;
  it('repeats a live code back with a Copy button, no model call', async () => {
    const pc = createPairCode(ME, null);
    await send(ME, ME, `groupie import ${pc.code.toLowerCase()} Project 2`);
    expect(talk).not.toHaveBeenCalled();
    const reply = lastSent();
    const text = String(reply.payload.text);
    expect(text).toContain(copy.WRONG_APP);
    expect(text).toContain(`<code>Groupie import ${pc.code} Project 2</code>`);
    expect(text).not.toContain(copy.CODE_EXPIRED_FRESH);
    expect(reply.payload.parse_mode).toBe('HTML');
    expect(markup(reply)).toContain(`"copy_text":{"text":"Groupie import ${pc.code} Project 2"}`);
    expect(markup(reply)).not.toContain('groupie-open-messages');
  });

  it('gives a fresh personal code for an unknown code', async () => {
    await send(ME, ME, 'Groupie import ZZZZZZ');
    expect(talk).not.toHaveBeenCalled();
    const text = String(lastSent().payload.text);
    expect(text).toContain(copy.CODE_EXPIRED_FRESH);
    const code = codeIn(text)!;
    expect(code).not.toBe('ZZZZZZ');
    expect(getPairCode(code)).toMatchObject({ telegramUserId: ME, groupChatId: null, purpose: 'import', usedAt: null });
  });

  it('gives a fresh code for the same group when the old one expired', async () => {
    const G = makeGroup();
    const old = createPairCode(ME, G, new Date(Date.now() - PAIR_CODE_TTL_MS - 1000));
    await send(ME, ME, `Groupie import ${old.code}`);
    const code = codeIn(String(lastSent().payload.text))!;
    expect(code).not.toBe(old.code);
    expect(getPairCode(code)).toMatchObject({ telegramUserId: ME, groupChatId: G });
  });

  it("treats someone else's code as unknown and never reuses their group", async () => {
    const G = makeGroup();
    const theirs = createPairCode(6199, G);
    await send(ME, ME, `Groupie import ${theirs.code}`);
    const text = String(lastSent().payload.text);
    expect(text).toContain(copy.CODE_EXPIRED_FRESH);
    expect(text).not.toContain(theirs.code);
    expect(getPairCode(codeIn(text)!)).toMatchObject({ telegramUserId: ME, groupChatId: null });
  });

  it('gives a fresh code for a used one', async () => {
    const pc = createPairCode(ME, null);
    expect(claimPairCode(pc.code)).toBe(true);
    await send(ME, ME, `Groupie import ${pc.code}`);
    expect(String(lastSent().payload.text)).toContain(copy.CODE_EXPIRED_FRESH);
  });
});

describe('wrong-app catch in a group', () => {
  it('replies without the model, with a fresh code for this group and the assignment words kept', async () => {
    const G = makeGroup({ nickname: 'Max' });
    await send(G, 6201, 'Groupie import ABCDEF project 2');
    expect(talk).not.toHaveBeenCalled();
    const reply = lastSent();
    const text = String(reply.payload.text);
    expect(text).toContain(copy.WRONG_APP);
    const code = codeIn(text)!;
    expect(text).toContain(`<code>Groupie import ${code} project 2</code>`);
    expect(getPairCode(code)).toMatchObject({ telegramUserId: 6201, groupChatId: G });
    expect(markup(reply)).toContain('copy_text');
  });

  it('still answers real questions with the model', async () => {
    const G = makeGroup({ nickname: 'Max' });
    await send(G, 6202, "Max, what's due?");
    expect(talk).toHaveBeenCalled();
  });
});

describe('Canvas before the team size', () => {
  it('/canvas in a group with no team size issues a code', async () => {
    const G = makeGroup();
    await send(G, 6301, '/canvas');
    const text = String(lastSent().payload.text);
    expect(text).toContain('Your Cubbie code');
    expect(getPairCode(codeIn(text)!)).toMatchObject({ groupChatId: G, telegramUserId: 6301 });
  });

  it('the Mini App pair-code route agrees', async () => {
    const G = makeGroup();
    const app = await startTestApp();
    try {
      const res = await fetch(`${app.base}/api/cubbie/pair-code`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-test-user': '6302' },
        body: JSON.stringify({ groupChatId: G }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { code: string; expiresAt: string };
      expect(getPairCode(body.code)).toMatchObject({ groupChatId: G });
    } finally {
      await app.close();
    }
  });

  it('an import posts the tasks, then the size question, then joining once a size is picked', async () => {
    const G = makeGroup({ nickname: 'Max' });
    const r = await ingestAssignment(G, { text: 'Build a campus food finder app with search, hours, and a map. '.repeat(3), sourceLabel: 'Project 2', source: 'canvas' });
    expect(r.ok).toBe(true);
    // Planned for the head count (4 in the chat, minus Groupie) since no size was picked.
    expect(vi.mocked(parseAssignment).mock.calls.at(-1)![1]).toBe(3);
    const taskList = calls.findIndex((c) => c.method === 'editMessageText' && String(c.payload.text).startsWith('<b>Got it: P2</b>'));
    const sizeAsk = calls.findIndex((c) => c.method === 'sendMessage' && String(c.payload.text) === copy.askSizeText('Max'));
    expect(taskList).toBeGreaterThan(-1);
    expect(sizeAsk).toBeGreaterThan(taskList);
    expect(markup(calls[sizeAsk]!)).toContain('size:3');
    expect(sent().some((c) => String(c.payload.text).includes('joined'))).toBe(false);
    const group = getGroup(G)!;
    expect(group).toMatchObject({ status: 'collecting_members', teamSize: null });
    const promptId = group.statusMessageId!;
    expect(promptId).toBe(msgId);

    calls = [];
    await tap(G, 6401, 'size:2', promptId);
    expect(getGroup(G)!.teamSize).toBe(2);
    expect(calls.find((c) => c.method === 'editMessageText')!.payload.text).toBe(copy.sizeSetText(2));
    const join = sent().find((c) => String(c.payload.text).includes('0/2 joined'));
    expect(join).toBeDefined();
    expect(getGroup(G)!.statusMessageId).not.toBe(promptId);

    // A second tap is too late: the size is locked.
    calls = [];
    await tap(G, 6401, 'size:3', promptId);
    expect(getGroup(G)!.teamSize).toBe(2);
    expect(calls.find((c) => c.method === 'answerCallbackQuery')!.payload.text).toBe(copy.SIZE_LOCKED);
  });

  it('runs the split when the size is picked after everyone already joined', async () => {
    const G = makeGroup({ status: 'collecting_members', assignmentTitle: 'P2' });
    for (const [title, effort] of [['A', 2], ['B', 3], ['C', 2]] as const) db.insert(schema.tasks).values({ groupId: G, title, effort }).run();
    for (const [tg, name] of [[6501, 'Ana'], [6502, 'Ben']] as const) {
      db.insert(schema.members).values({ groupId: G, tgUserId: tg, name, color: '#FFB547', createdAt: created }).run();
    }
    await tap(G, 6501, 'size:2', 1);
    expect(['split_ready', 'scheduling']).toContain(getGroup(G)!.status);
    expect(sent().some((c) => String(c.payload.text).includes('Fair split'))).toBe(true);
  });

  it('does not split while the size is unset', async () => {
    const G = makeGroup({ status: 'collecting_members', assignmentTitle: 'P2' });
    db.insert(schema.members).values({ groupId: G, tgUserId: 6601, name: 'Ana', color: '#FFB547', createdAt: created }).run();
    const { maybeRunSplit } = await import('./split.ts');
    await maybeRunSplit(G);
    expect(getGroup(G)!.status).toBe('collecting_members');
  });
});

describe('"Tap a team size above"', () => {
  it('points up when the size buttons are close, and re-posts them when far', async () => {
    const G = makeGroup({ status: 'collecting_members', statusMessageId: 5000 });
    await send(G, 6701, '/join', 5004);
    expect(lastSent().payload.text).toBe(copy.TAP_SIZE_ABOVE);
    expect(getGroup(G)!.statusMessageId).toBe(5000);

    calls = [];
    await send(G, 6701, '/join', 5020);
    const repost = lastSent();
    expect(repost.payload.text).toBe(copy.askSizeText('Groupie'));
    expect(markup(repost)).toContain('size:');
    expect(getGroup(G)!.statusMessageId).toBe(msgId);
    expect(sent().some((c) => c.payload.text === copy.TAP_SIZE_ABOVE)).toBe(false);
  });

  it('re-posts the buttons when no size prompt is known', async () => {
    const G = makeGroup({ status: 'collecting_members' });
    await send(G, 6702, '/join', 10);
    expect(lastSent().payload.text).toBe(copy.askSizeText('Groupie'));
  });

  it('/setup after the tasks landed asks for the size again', async () => {
    const G = makeGroup({ status: 'collecting_members' });
    await send(G, 6703, '/setup');
    expect(lastSent().payload.text).toBe(copy.askSizeText('Groupie'));
  });
});

describe('/reset', () => {
  it('replays the fresh-join welcome with both buttons and never keeps the old name', async () => {
    env.devMode = true;
    const G = makeGroup({ nickname: 'Max', teamSize: 3, status: 'collecting_members' });
    await send(G, 6801, '/reset');
    const texts = sent().map((c) => c.payload.text);
    expect(texts).toEqual([copy.RESET_DONE, copy.WELCOME]);
    const resetWelcome = lastSent();
    expect(markup(resetWelcome)).toContain('"callback_data":"nick:name"');
    expect(markup(resetWelcome)).toContain('"callback_data":"nick:keep"');
    expect(markup(resetWelcome)).toContain(copy.BUTTON.nameMe);
    expect(markup(resetWelcome)).toContain(copy.BUTTON.keepName);
    expect(getGroup(G)).toMatchObject({ nickname: 'Groupie', teamSize: null, status: 'setup' });

    // Same message as being added to a group.
    calls = [];
    const J = nextGroup--;
    await bot.handleUpdate({
      update_id: updateId++,
      my_chat_member: {
        chat: { id: J, type: 'group', title: 'New' },
        from: user(6801),
        date: 0,
        old_chat_member: { status: 'left', user: { id: 1, is_bot: true, first_name: 'Groupie' } },
        new_chat_member: { status: 'member', user: { id: 1, is_bot: true, first_name: 'Groupie' } },
      },
    } as Update);
    const joinWelcome = lastSent();
    expect(joinWelcome.payload.text).toBe(resetWelcome.payload.text);
    expect(markup(joinWelcome)).toBe(markup(resetWelcome));
  });
});

describe('pair code lifetime', () => {
  it('is 30 minutes, and the copy says so', () => {
    expect(PAIR_CODE_TTL_MS).toBe(30 * 60 * 1000);
    const now = new Date('2026-10-25T04:00:00Z');
    expect(createPairCode(6901, null, now).expiresAt).toBe('2026-10-25T04:30:00.000Z');
    expect(canvasCodeText('K7Q2MX')).toContain('within 30 minutes');
  });
});
