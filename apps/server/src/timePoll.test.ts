import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Update } from 'grammy/types';
import { db, schema } from './db/index.ts';
import { bot } from './bot/index.ts';
import {
  checkAvailDeadlines,
  confirmTime,
  decodeStarts,
  encodeStarts,
  lockMeeting,
  onAvailabilityChanged,
  pickWinner,
} from './bot/schedule.ts';
import { latestMeeting, setSlots } from './availability.ts';
import { getGroup, getPending } from './groups.ts';

type Call = { method: string; payload: Record<string, unknown>; result?: unknown };
let calls: Call[] = [];
/** Vote counts the next stopPoll returns (or an error to throw). */
let nextVotes: number[] | Error = [];
/** When set, the next sendPoll fails with this description. */
let failPoll: string | null = null;
let msgId = 100;

beforeAll(() => {
  bot.botInfo = {
    id: 1,
    is_bot: true,
    first_name: 'Groupie',
    username: 'GroupieTestBot',
    can_join_groups: true,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
    can_connect_to_business: false,
    has_main_web_app: false,
  } as typeof bot.botInfo;
  // Every Telegram call is recorded and answered locally.
  bot.api.config.use(async (_prev, method, payload) => {
    const call: Call = { method, payload: payload as Record<string, unknown> };
    calls.push(call);
    const id = ++msgId;
    const chat = { id: (payload as { chat_id?: number }).chat_id ?? 0, type: 'group', title: 'T' };
    let result: unknown = true;
    if (method === 'sendMessage' || method === 'sendDocument') result = { message_id: id, date: 0, chat };
    if (method === 'sendPoll') {
      if (failPoll) return { ok: false, error_code: 400, description: failPoll } as never;
      result = { message_id: id, date: 0, chat, poll: { id: `poll${id}` } };
    }
    if (method === 'stopPoll') {
      if (nextVotes instanceof Error) return { ok: false, error_code: 400, description: nextVotes.message } as never;
      result = { id: 'p', options: nextVotes.map((voter_count, i) => ({ text: `o${i}`, voter_count })) };
    }
    call.result = result;
    return { ok: true, result } as never;
  });
});
afterEach(() => {
  calls = [];
  nextVotes = [];
  failPoll = null;
});

const created = new Date().toISOString();
const HOUR = 3_600_000;
/** A slot boundary two days out, so every hour below is in the future and on the grid window. */
const base = Math.ceil((Date.now() + 2 * 24 * HOUR) / (30 * 60_000)) * 30 * 60_000;
const at = (h: number) => new Date(base + h * HOUR).toISOString();
const halfHours = (fromH: number, count: number) => Array.from({ length: count }, (_, i) => new Date(base + fromH * HOUR + i * 1_800_000).toISOString());

let nextGroup = -5000;
function makeGroup(teamSize: number, status: 'scheduling' | 'active' = 'scheduling') {
  const id = nextGroup--;
  db.insert(schema.groups).values({ id, title: 'Team', tz: 'America/Phoenix', createdAt: created, teamSize, status, assignmentTitle: 'P2' }).run();
  const members = Array.from({ length: teamSize }, (_, i) =>
    db.insert(schema.members).values({ groupId: id, tgUserId: Math.abs(id) * 10 + i, name: `M${i}`, color: '#FF6B5B', createdAt: created }).returning().get(),
  );
  return { id, members };
}

const sent = (method: string) => calls.filter((c) => c.method === method);
const texts = () => calls.filter((c) => c.method === 'sendMessage').map((c) => String(c.payload.text));
const edits = () => calls.filter((c) => c.method === 'editMessageText').map((c) => String(c.payload.text));
const timePoll = () => sent('sendPoll').find((c) => c.payload.question === 'Which time works?');
const confirmData = (c: Call) =>
  ((c.payload.reply_markup as { inline_keyboard: { callback_data: string }[][] }).inline_keyboard[0]![0]!.callback_data);

let updateId = 1;
const tap = (groupId: number, from: number, data: string, messageId: number): Update => ({
  update_id: updateId++,
  callback_query: {
    id: String(updateId),
    from: { id: from, is_bot: false, first_name: 'Ava' },
    chat_instance: 'x',
    data,
    message: { message_id: messageId, date: 0, chat: { id: groupId, type: 'group', title: 'Team' } },
  },
} as Update);
const say = (groupId: number, from: number, text: string): Update => ({
  update_id: updateId++,
  message: { message_id: updateId, date: 0, chat: { id: groupId, type: 'group', title: 'Team' }, from: { id: from, is_bot: false, first_name: 'Ava' }, text },
} as Update);

describe('helpers', () => {
  it('round-trips candidate starts through the button', () => {
    const starts = [at(0), at(5), at(30)];
    const raw = encodeStarts(starts);
    expect(`time:confirm:${raw}`.length).toBeLessThanOrEqual(64);
    expect(decodeStarts(raw)).toEqual(starts);
  });
  it('picks the most votes, ties to the higher-ranked option', () => {
    expect(pickWinner([1, 3, 2])).toBe(1);
    expect(pickWinner([2, 2, 1])).toBe(0);
    expect(pickWinner([0, 4, 4])).toBe(1);
    expect(pickWinner([0, 0, 0])).toBe(0);
  });
});

describe('time poll', () => {
  it('posts a non-anonymous top 3 poll once everyone is in, only once', async () => {
    const g = makeGroup(3);
    for (const m of g.members) setSlots(m.id, [...halfHours(0, 2), ...halfHours(4, 2), ...halfHours(8, 4)]);
    await onAvailabilityChanged(g.id);
    const poll = timePoll()!;
    expect(poll.payload.is_anonymous).toBe(false);
    const options = (poll.payload.options as { text: string }[]).map((o) => o.text);
    expect(options).toHaveLength(3);
    expect(options[0]).toMatch(/\(3\/3 free\)$/);
    expect(decodeStarts(confirmData(poll).slice('time:confirm:'.length))).toEqual([at(8), at(9), at(0)]); // back-to-back hours do not overlap
    expect(getGroup(g.id)!.status).toBe('active');
    expect(latestMeeting(g.id)).toBeUndefined();

    calls = [];
    await onAvailabilityChanged(g.id);
    expect(timePoll()).toBeUndefined();
  });

  it('skips the poll when only one hour works and runs the existing flow', async () => {
    const g = makeGroup(2);
    for (const m of g.members) setSlots(m.id, halfHours(3, 2));
    await lockMeeting(g.id);
    expect(timePoll()).toBeUndefined();
    expect(latestMeeting(g.id)).toMatchObject({ start: at(3), end: at(4) });
    expect(texts().some((t) => t.startsWith('<b>Best time:'))).toBe(true);
    expect(sent('sendPoll').map((c) => c.payload.question)).toEqual(['How should we meet?']);
  });

  it('says so when nobody overlaps', async () => {
    const g = makeGroup(2);
    setSlots(g.members[0]!.id, halfHours(1, 2));
    setSlots(g.members[1]!.id, halfHours(5, 2));
    expect(await lockMeeting(g.id)).toBe(false);
    expect(texts().some((t) => t.includes("Nobody's free times overlap"))).toBe(true);
    expect(getGroup(g.id)!.status).toBe('scheduling');

    // A second try edits the same message instead of stacking another copy.
    calls = [];
    expect(await lockMeeting(g.id)).toBe(false);
    expect(texts().some((t) => t.includes("Nobody's free times overlap"))).toBe(false);
    expect(edits().some((t) => t.includes("Nobody's free times overlap"))).toBe(true);
  });

  it('says so and stays in scheduling when the time poll will not post', async () => {
    const g = makeGroup(2);
    for (const m of g.members) setSlots(m.id, [...halfHours(0, 2), ...halfHours(4, 2)]);
    failPoll = 'Bad Request: polls are not allowed';
    expect(await lockMeeting(g.id)).toBe(false);
    expect(texts()).toContain("I couldn't post the time poll. Tap <b>Lock it now</b> to try again?");
    expect(getGroup(g.id)!.status).toBe('scheduling');
  });

  it('confirm picks the most-voted time, ties to the higher rank, and only once', async () => {
    const g = makeGroup(2, 'active');
    for (const m of g.members) setSlots(m.id, [...halfHours(0, 2), ...halfHours(4, 2), ...halfHours(8, 2)]);
    nextVotes = [1, 2, 2];
    expect(await confirmTime(g.id, 55, [at(0), at(4), at(8)])).toBe('done');
    expect(sent('stopPoll')[0]!.payload).toMatchObject({ chat_id: g.id, message_id: 55 });
    expect(latestMeeting(g.id)).toMatchObject({ start: at(4), end: at(5) });

    nextVotes = new Error('Bad Request: poll has already been closed');
    expect(await confirmTime(g.id, 55, [at(0), at(4), at(8)])).toBe('already');
  });

  it('confirm then continues into the existing meeting flow end to end', async () => {
    const g = makeGroup(3);
    for (const m of g.members) setSlots(m.id, [...halfHours(0, 2), ...halfHours(4, 2), ...halfHours(8, 2)]);
    await lockMeeting(g.id);
    const poll = timePoll()!;
    const pollMsg = (poll.result as { message_id: number }).message_id;
    const asker = g.members[0]!.tgUserId!;

    calls = [];
    nextVotes = [0, 0, 3];
    await bot.handleUpdate(tap(g.id, asker, confirmData(poll), pollMsg));
    const meeting = latestMeeting(g.id)!;
    expect(meeting).toMatchObject({ start: at(8), end: at(9) });
    expect(texts().some((t) => t.startsWith('<b>Best time:') && t.includes('3/3 free'))).toBe(true);
    expect(sent('sendPoll').map((c) => c.payload.question)).toEqual(['How should we meet?']);
    expect(texts()).toContain('Vote above, then tap below and I will send everyone the invite.');

    // Zoom wins the how-to-meet poll, then the link, card, .ics, and DMs.
    calls = [];
    nextVotes = [0, 2, 0];
    await bot.handleUpdate(tap(g.id, asker, 'cal:invite', 999));
    expect(latestMeeting(g.id)!.mode).toBe('zoom');
    expect(edits()).toContain('Zoom it is. Sending the invite...');
    expect(getPending(g.id, asker)?.kind).toBe('meeting_link');
    expect(texts().some((t) => t.includes('reply with the Zoom link'))).toBe(true);

    calls = [];
    await bot.handleUpdate(say(g.id, asker, 'https://zoom.us/j/123456789'));
    expect(latestMeeting(g.id)!.meetLink).toBe('https://zoom.us/j/123456789');
    // A "one sec" message first, then the same message becomes the meeting card.
    expect(texts().some((t) => t.includes('Setting up your meeting, one sec...'))).toBe(true);
    expect(edits().some((t) => t.includes('Team meeting is on!'))).toBe(true);
    expect(sent('sendDocument')).toHaveLength(1);
    const dms = sent('sendMessage').filter((c) => g.members.some((m) => m.tgUserId === c.payload.chat_id));
    expect(dms).toHaveLength(3);
  });
});

describe('deadline', () => {
  it('proposes times once the deadline passes, and only once', async () => {
    const g = makeGroup(3);
    for (const m of g.members.slice(0, 2)) setSlots(m.id, [...halfHours(0, 2), ...halfHours(4, 2)]);
    const later = makeGroup(3);
    for (const m of later.members.slice(0, 2)) setSlots(m.id, halfHours(0, 2));
    const now = new Date();
    db.update(schema.groups).set({ availDeadlineAt: new Date(now.getTime() - 60_000).toISOString() }).where(eqId(g.id)).run();
    db.update(schema.groups).set({ availDeadlineAt: new Date(now.getTime() + HOUR).toISOString() }).where(eqId(later.id)).run();

    expect(await checkAvailDeadlines(now)).toBe(1);
    const poll = timePoll()!;
    expect(poll.payload.chat_id).toBe(g.id);
    expect((poll.payload.options as unknown[]).length).toBe(2);
    expect(getGroup(g.id)!.availDeadlineAt).toBeNull();
    expect(getGroup(later.id)!.status).toBe('scheduling');

    calls = [];
    expect(await checkAvailDeadlines(now)).toBe(0);
    expect(timePoll()).toBeUndefined();
  });

  it('the Lock in 24h button sets the deadline', async () => {
    const g = makeGroup(3);
    await bot.handleUpdate(tap(g.id, g.members[0]!.tgUserId!, 'avail:deadline:24', 1));
    const due = Date.parse(getGroup(g.id)!.availDeadlineAt!);
    expect(Math.abs(due - (Date.now() + 24 * HOUR))).toBeLessThan(60_000);
  });
});

function eqId(id: number) {
  return eq(schema.groups.id, id);
}
