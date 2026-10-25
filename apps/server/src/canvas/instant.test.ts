import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Update } from 'grammy/types';

// No model in these tests: /canvas answers and wrong-app replies must never call it.
vi.mock('../llm.ts', async (orig) => ({ ...(await orig<typeof import('../llm.ts')>()), talk: vi.fn(async () => 'MODEL ANSWER') }));
vi.mock('../cards/render.ts', () => ({
  renderPng: vi.fn(async () => {
    throw new Error('no browser in tests');
  }),
  closeRenderer: vi.fn(async () => {}),
}));

const { talk } = await import('../llm.ts');
const { db, schema } = await import('../db/index.ts');
const { bot } = await import('../bot/index.ts');
const { appUrl } = await import('../bot/core.ts');
const { getPairCode } = await import('./pairCodes.ts');
const { matchCubbieText } = await import('./bot.ts');
const { dueLabelIn, findNamed, firstSentence, mainAppUrl, ownCanvasItems, parseCanvasIntent } = await import('./instant.ts');
const { cubbieOpenUrl, OPEN_IN_IMESSAGE } = await import('./goCubbie.ts');
const copy = await import('../copy.ts');

type Call = { method: string; payload: Record<string, unknown> };
let calls: Call[] = [];
let msgId = 7000;
/** Users the bot cannot DM (Telegram 403). */
const blocked = new Set<number>();

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
    if (method === 'sendMessage' && blocked.has(chatId)) {
      return { ok: false, error_code: 403, description: "Forbidden: bot can't initiate conversation with a user" } as never;
    }
    const chat = { id: chatId, type: chatId < 0 ? 'group' : 'private', title: 'T' };
    let result: unknown = true;
    if (method === 'sendMessage') result = { message_id: ++msgId, date: 0, chat };
    return { ok: true, result } as never;
  });
});
afterEach(() => {
  calls = [];
  vi.mocked(talk).mockClear();
});

const sent = () => calls.filter((c) => c.method === 'sendMessage');
const to = (chatId: number) => sent().filter((c) => c.payload.chat_id === chatId);
const textOf = (c: Call | undefined) => String(c?.payload.text ?? '');
const markup = (c: Call | undefined) => JSON.stringify(c?.payload.reply_markup ?? null);
const urls = (c: Call | undefined) =>
  ((c?.payload.reply_markup as { inline_keyboard?: { text: string; url?: string; callback_data?: string }[][] })?.inline_keyboard ?? []).flat();
const now = new Date();
const iso = now.toISOString();
const inDays = (d: number) => new Date(now.getTime() + d * 86_400_000).toISOString();

let nextGroup = -8800;
function makeGroup(fields: Partial<typeof schema.groups.$inferInsert> = {}) {
  const id = nextGroup--;
  db.insert(schema.groups).values({ id, title: 'Capstone Team', tz: 'America/Phoenix', createdAt: iso, ...fields }).run();
  return id;
}
let uid = 0;
function cal(telegramUserId: number, title: string, dueAt: string, course: string | null = 'CSE 485 (Fall 2026)', description: string | null = null) {
  return db
    .insert(schema.calendarEvents)
    .values({ telegramUserId, uid: `u${++uid}`, course, title, dueAt, description, kind: 'assignment', updatedAt: iso })
    .returning()
    .get();
}
function imp(telegramUserId: number, title: string, dueAt: string | null, groupChatId: number | null = null, extra: Record<string, unknown> = {}) {
  return db
    .insert(schema.cubbieImports)
    .values({
      telegramUserId,
      groupChatId,
      pairCode: null,
      status: 'imported',
      createdAt: iso,
      payload: { course: { name: 'CSE 485: Capstone' }, assignment: { title, dueAt, pointsPossible: 100, descriptionText: '', url: null, ...extra } },
    })
    .returning()
    .get();
}
const link = (telegramUserId: number) =>
  db.insert(schema.cubbieLinks).values({ telegramUserId, tokenHash: `h${telegramUserId}${Math.random()}`, createdAt: iso }).run();

let updateId = 1;
const user = (id: number) => ({ id, is_bot: false, first_name: 'Ana' });
function textUpdate(chatId: number, fromId: number, text: string): Update {
  const chat = chatId < 0 ? { id: chatId, type: 'group' as const, title: 'Team' } : { id: chatId, type: 'private' as const, first_name: 'Ana' };
  const command = /^\/\w+/.exec(text);
  return {
    update_id: updateId++,
    message: {
      message_id: ++msgId,
      date: 0,
      chat,
      from: user(fromId),
      text,
      ...(command ? { entities: [{ type: 'bot_command' as const, offset: 0, length: command[0].length }] } : {}),
    },
  } as Update;
}
const send = (chatId: number, fromId: number, text: string) => bot.handleUpdate(textUpdate(chatId, fromId, text));
const tap = (chatId: number, fromId: number, data: string) =>
  bot.handleUpdate({
    update_id: updateId++,
    callback_query: {
      id: String(updateId),
      from: user(fromId),
      chat_instance: 'x',
      data,
      message: { message_id: 1, date: 0, chat: { id: chatId, type: 'group', title: 'Team' } },
    },
  } as Update);
const codeIn = (s: string) => /Groupie import ([A-Z0-9]{6})/.exec(decodeURIComponent(s))?.[1];

describe('intent parsing', () => {
  it('reads next, this week, a named assignment, and nothing', () => {
    expect(parseCanvasIntent('send me my next due assignment')).toEqual({ kind: 'next' });
    expect(parseCanvasIntent("what's due this week")).toEqual({ kind: 'week' });
    expect(parseCanvasIntent('what’s due?')).toEqual({ kind: 'week' });
    expect(parseCanvasIntent('sprint 3')).toEqual({ kind: 'named', query: 'sprint 3' });
    expect(parseCanvasIntent('pull the Sprint 3 report please')).toEqual({ kind: 'named', query: 'Sprint 3 report' });
    expect(parseCanvasIntent('')).toEqual({ kind: 'none' });
    expect(parseCanvasIntent('  please ')).toEqual({ kind: 'none' });
  });
  it('matches names by every word, numbers exactly', () => {
    const items = [
      { ref: 'e1', title: 'Capstone Project I Sprint 3 report', course: null, dueAt: null, points: null, description: null, url: null, groupChatId: null },
      { ref: 'e2', title: 'Sprint 13 report', course: null, dueAt: null, points: null, description: null, url: null, groupChatId: null },
    ];
    expect(findNamed(items, 'sprint 3').map((i) => i.ref)).toEqual(['e1']);
    expect(findNamed(items, 'sprint 4')).toEqual([]);
  });
  it('formats due times in Phoenix and keeps descriptions to one sentence', () => {
    expect(dueLabelIn('2026-11-21T06:59:00Z', 'America/Phoenix')).toBe('Fri Nov 20, 11:59 PM MST');
    expect(firstSentence('Write the sprint report. Then present it.')).toBe('Write the sprint report.');
    expect(firstSentence('x'.repeat(300))!.length).toBeLessThanOrEqual(140);
  });
});

describe('/canvas with free text in a DM', () => {
  const ME = 9101;
  const OTHER = 9102;
  beforeAll(() => {
    cal(ME, 'Lab 4', inDays(2), 'CSE 340 (Fall 2026)');
    cal(ME, 'Far essay', inDays(10), 'ENG 102');
    imp(ME, 'Capstone Project I Sprint 3 report', inDays(5), null, {
      descriptionText: 'Write the Sprint 3 report covering every user story you closed. Use the template.',
    });
    cal(OTHER, 'OTHER_PERSON_MARKER', inDays(1));
    imp(OTHER, 'OTHER_IMPORT_MARKER', inDays(1));
  });

  it('next: answers from my items only, with the Cubbie button and a code for an unlinked user', async () => {
    await send(ME, ME, '/canvas send me my next due assignment');
    expect(talk).not.toHaveBeenCalled();
    const r = to(ME).at(-1);
    const text = textOf(r);
    expect(text).toContain(copy.CANVAS_HEAD.next);
    expect(text).toContain('<b>Lab 4</b>');
    expect(text).toContain('CSE 340 (Fall 2026)');
    expect(text).toMatch(/Due \w{3} \w{3} \d{1,2}, \d{1,2}:\d{2} [AP]M MST/);
    expect(text).not.toContain('OTHER_');
    expect(text).toContain('First time only');
    const pull = urls(r).find((b) => b.text === copy.CANVAS_BUTTON.pull)!;
    const code = codeIn(pull.url!)!;
    expect(pull.url).toBe(cubbieOpenUrl(`Groupie import ${code} Lab 4`));
    expect(getPairCode(code)).toMatchObject({ telegramUserId: ME, groupChatId: null });
    expect(urls(r).some((b) => b.text === copy.CANVAS_BUTTON.split)).toBe(false);
  });

  it('this week: lists the next 7 days, soonest first', async () => {
    await send(ME, ME, "/canvas what's due this week");
    const text = textOf(to(ME).at(-1));
    expect(text).toContain(copy.CANVAS_HEAD.week);
    expect(text.indexOf('Lab 4')).toBeLessThan(text.indexOf('Sprint 3 report'));
    expect(text).not.toContain('Far essay');
    expect(text).not.toContain('OTHER_');
  });

  it('named: finds the import with points and the first sentence of the description', async () => {
    await send(ME, ME, '/canvas sprint 3');
    const text = textOf(to(ME).at(-1));
    expect(text).toContain(copy.CANVAS_HEAD.named);
    expect(text).toContain('Capstone Project I Sprint 3 report');
    expect(text).toContain('100 points');
    expect(text).toContain('Write the Sprint 3 report covering every user story you closed.');
    expect(text).not.toContain('Use the template');
  });

  it('named and missing: says so and offers Cubbie', async () => {
    await send(ME, ME, '/canvas quiz 9');
    const r = to(ME).at(-1);
    expect(textOf(r)).toContain(copy.canvasNotFound('quiz 9'));
    expect(decodeURIComponent(urls(r)[0]!.url!)).toMatch(/Groupie import [A-Z0-9]{6} quiz 9$/);
  });

  it("never lists another user's items (owner-only read)", () => {
    const mine = ownCanvasItems(ME, now).map((i) => i.title);
    expect(mine).toEqual(['Lab 4', 'Capstone Project I Sprint 3 report', 'Far essay']);
  });
});

describe('linked users', () => {
  const ME = 9201;
  beforeAll(() => {
    cal(ME, 'Lab 7', inDays(1));
    link(ME);
  });
  it('hide the install line and get code-free Cubbie text', async () => {
    await send(ME, ME, '/canvas next');
    const r = to(ME).at(-1);
    expect(textOf(r)).not.toContain('First time only');
    expect(urls(r)[0]!.url).toBe(cubbieOpenUrl('Groupie import Lab 7'));
  });
  it('hide the install line in the plain code reply too', async () => {
    await send(ME, ME, '/canvas');
    expect(textOf(to(ME).at(-1))).not.toContain('First time only');
    await send(9299, 9299, '/canvas');
    expect(textOf(to(9299).at(-1))).toContain('First time only');
  });
  it('a revoked link shows it again', async () => {
    const U = 9202;
    cal(U, 'Lab 8', inDays(1));
    db.insert(schema.cubbieLinks).values({ telegramUserId: U, tokenHash: 'revoked-9202', createdAt: iso, revokedAt: iso }).run();
    await send(U, U, '/canvas next');
    expect(textOf(to(U).at(-1))).toContain('First time only');
  });
});

describe('/canvas with free text in a group', () => {
  const ME = 9301;
  const MATE = 9302;
  it("posts this course's items in the group and DMs the rest", async () => {
    const G = makeGroup({ canvasCourse: 'CSE 485: Capstone', status: 'setup' });
    const course = cal(ME, 'Sprint 4 demo', inDays(2), 'CSE 485 (Fall 2026)');
    cal(ME, 'PRIVATE_HISTORY_ESSAY', inDays(3), 'HST 101');
    cal(MATE, 'MATE_MARKER', inDays(1), 'CSE 485 (Fall 2026)');
    await send(G, ME, "/canvas what's due this week");
    expect(talk).not.toHaveBeenCalled();
    const g = to(G).at(-1);
    expect(textOf(g)).toContain('Sprint 4 demo');
    expect(textOf(g)).toContain(copy.CANVAS_DM_SENT);
    expect(textOf(g)).not.toContain('PRIVATE_HISTORY_ESSAY');
    expect(textOf(g)).not.toContain('HST');
    expect(textOf(g)).not.toContain('MATE_MARKER');
    const dm = to(ME).at(-1);
    expect(textOf(dm)).toContain('PRIVATE_HISTORY_ESSAY');
    expect(textOf(dm)).not.toContain('Sprint 4 demo');
    // [Split this one] issues a group code for the asker and the Open in iMessage button.
    const split = urls(g).find((b) => b.text === copy.CANVAS_BUTTON.split)!;
    expect(split.callback_data).toBe(`cv:split:e${course.id}`);
    await tap(G, MATE, split.callback_data!);
    const toast = calls.filter((c) => c.method === 'answerCallbackQuery').at(-1)!;
    expect(toast.payload.text).toBe(copy.SPLIT_NOT_YOURS);
    await tap(G, ME, split.callback_data!);
    const reply = to(G).at(-1)!;
    const code = codeIn(textOf(reply))!;
    expect(getPairCode(code)).toMatchObject({ telegramUserId: ME, groupChatId: G });
    expect(textOf(reply)).toContain(`<code>Groupie import ${code} Sprint 4 demo</code>`);
    expect(urls(reply).find((b) => b.text === OPEN_IN_IMESSAGE)!.url).toBe(cubbieOpenUrl(`Groupie import ${code} Sprint 4 demo`));
    expect(markup(reply)).toContain('copy_text');
  });

  it('with no course set, sends everything by DM and only the DM line in the group', async () => {
    const U = 9311;
    const G = makeGroup();
    cal(U, 'SECRET_COURSE_ITEM', inDays(1), 'BIO 100');
    await send(G, U, '/canvas next');
    expect(textOf(to(G).at(-1))).toBe(copy.CANVAS_DM_SENT);
    expect(textOf(to(U).at(-1))).toContain('SECRET_COURSE_ITEM');
  });

  it("falls back to the Start hint when Telegram won't let me DM", async () => {
    const U = 9312;
    const G = makeGroup();
    cal(U, 'SECRET_COURSE_ITEM', inDays(1), 'BIO 100');
    blocked.add(U);
    await send(G, U, '/canvas next');
    blocked.delete(U);
    expect(textOf(to(G).at(-1))).toBe(copy.DM_BLOCKED);
    expect(sent().some((c) => textOf(c).includes('SECRET_COURSE_ITEM') && c.payload.chat_id === G)).toBe(false);
  });

  it("posts the group's own import in the group even with no course", async () => {
    const U = 9313;
    const G = makeGroup();
    imp(U, 'Group Project Brief', inDays(4), G);
    await send(G, U, '/canvas project brief');
    expect(textOf(to(G).at(-1))).toContain('Group Project Brief');
  });

  it('a named assignment not found in a group waiting for one runs the usual code flow', async () => {
    const U = 9314;
    const G = makeGroup();
    cal(U, 'Lab 1', inDays(1), 'BIO 100');
    await send(G, U, '/canvas Project 2');
    const text = textOf(to(G).at(-1));
    expect(text).toContain('Your Cubbie code');
    const code = codeIn(text)!;
    expect(text).toContain(`Groupie import ${code} Project 2`);
    expect(getPairCode(code)).toMatchObject({ groupChatId: G });
  });
});

describe('nothing connected', () => {
  it('in a DM with no group: one line, Connect calendar to the main app, and the Cubbie path', async () => {
    const U = 9401;
    await send(U, U, '/canvas next');
    const r = to(U).at(-1);
    expect(textOf(r).split('\n')[0]).toBe(copy.CANVAS_NOT_CONNECTED);
    const b = urls(r);
    expect(b.find((x) => x.text === copy.CANVAS_BUTTON.connect)!.url).toBe(mainAppUrl());
    expect(decodeURIComponent(b.find((x) => x.text === copy.CANVAS_BUTTON.viaCubbie)!.url!)).toMatch(/Groupie import [A-Z0-9]{6}$/);
  });
  it('with a group: Connect calendar opens that group', async () => {
    const U = 9402;
    const G = makeGroup();
    await send(G, U, '/canvas what is due this week');
    const r = to(G).at(-1);
    expect(textOf(r)).toContain(copy.CANVAS_NOT_CONNECTED);
    expect(urls(r).find((x) => x.text === copy.CANVAS_BUTTON.connect)!.url).toBe(appUrl(G, 'calendar'));
    const code = codeIn(urls(r).find((x) => x.text === copy.CANVAS_BUTTON.viaCubbie)!.url!)!;
    expect(getPairCode(code)).toMatchObject({ groupChatId: G, telegramUserId: U });
  });
});

describe('wrong app: Groupie status and code-free imports', () => {
  it('matches status alone and imports with or without a code', () => {
    expect(matchCubbieText('Groupie status')).toEqual({ kind: 'status' });
    expect(matchCubbieText('  groupie STATUS?! ')).toEqual({ kind: 'status' });
    expect(matchCubbieText('groupie status of my team')).toBeNull();
    expect(matchCubbieText('groupie import sprint 3')).toEqual({ kind: 'import', code: null, rest: 'sprint 3' });
    expect(matchCubbieText('groupie import report')).toEqual({ kind: 'import', code: null, rest: 'report' });
    expect(matchCubbieText('groupie import K7Q2MX lab')).toEqual({ kind: 'import', code: 'K7Q2MX', rest: 'lab' });
    expect(matchCubbieText('Groupie, what is due?')).toBeNull();
  });

  it('"Groupie status" in a DM: the exact text, Open in iMessage and Copy, no model call', async () => {
    const U = 9501;
    await send(U, U, 'Groupie status.');
    expect(talk).not.toHaveBeenCalled();
    const r = to(U).at(-1);
    expect(textOf(r)).toContain(copy.WRONG_APP_CUBBIE);
    expect(textOf(r)).toContain('<code>Groupie status</code>');
    expect(textOf(r)).toContain(copy.LINK_FIRST_DM);
    expect(urls(r).find((b) => b.text === OPEN_IN_IMESSAGE)!.url).toBe(cubbieOpenUrl('Groupie status'));
    expect(markup(r)).toContain('"copy_text":{"text":"Groupie status"}');
  });

  it('"groupie status" in a group is caught before the model', async () => {
    const G = makeGroup({ nickname: 'Max' });
    const U = 9502;
    link(U);
    await send(G, U, 'groupie status');
    expect(talk).not.toHaveBeenCalled();
    const r = to(G).at(-1);
    expect(textOf(r)).toContain('<code>Groupie status</code>');
    expect(textOf(r)).not.toContain('Link your iMessage');
  });

  it('a code-free import: linked users keep it code-free, others get a code', async () => {
    const L = 9503;
    link(L);
    await send(L, L, 'groupie import sprint 3');
    expect(textOf(to(L).at(-1))).toContain('<code>Groupie import sprint 3</code>');
    const U = 9504;
    await send(U, U, 'groupie import sprint 3');
    const text = textOf(to(U).at(-1));
    const code = codeIn(text)!;
    expect(text).toContain(`<code>Groupie import ${code} sprint 3</code>`);
    expect(text).not.toContain(copy.CODE_EXPIRED_FRESH);
    expect(talk).not.toHaveBeenCalled();
  });
});
