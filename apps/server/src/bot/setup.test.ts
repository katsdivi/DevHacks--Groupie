import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Update } from 'grammy/types';
import { db, schema } from '../db/index.ts';
import { seed, seedGroup, wipe } from '../setupStatus.fixture.ts';
import { bot } from './index.ts';
import { getPrefs } from '../prefs.ts';
import * as copy from '../copy.ts';

const U = 9401;
const G = -9401;
type Call = { method: string; payload: Record<string, unknown> };
const calls: Call[] = [];
let updateId = 1;

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
    const result = method === 'sendMessage' ? { message_id: 1, date: 0, chat: { id: chatId, type: chatId < 0 ? 'group' : 'private' } } : true;
    return { ok: true, result } as never;
  });
});
beforeEach(() => {
  calls.length = 0;
  wipe();
  db.delete(schema.meetings).run();
});

function send(chatId: number, text: string) {
  const chat = chatId < 0 ? { id: chatId, type: 'group' as const, title: 'Team Alpha' } : { id: chatId, type: 'private' as const, first_name: 'Ana' };
  const command = /^\/\w+/.exec(text)![0];
  return bot.handleUpdate({
    update_id: updateId++,
    message: { message_id: 1, date: 0, chat, from: { id: U, is_bot: false, first_name: 'Ana' }, text, entities: [{ type: 'bot_command', offset: 0, length: command.length }] },
  } as Update);
}
const last = () => calls.filter((c) => c.method === 'sendMessage').at(-1)!;
const buttons = (c: Call) =>
  ((c.payload.reply_markup as { inline_keyboard?: { text: string; url?: string; callback_data?: string }[][] } | undefined)?.inline_keyboard ?? []).flat();

describe('/setup in a DM', () => {
  it('shows the checklist with a button for the next 1 to 3 steps', async () => {
    await send(U, '/setup');
    const text = String(last().payload.text);
    expect(text).toContain('<b>Your setup:</b> 1 of 6 done.');
    expect(text).toContain('⬜ Add me to your project group');
    expect(text).toContain('✅ Reminders on');
    expect(text).not.toContain(copy.GROUP_ONLY);
    const b = buttons(last());
    expect(b.map((x) => x.text)).toEqual(['Add me to a group', 'Link iMessage']);
    expect(b[0]!.url).toContain('startgroup=true');
    expect(b[1]!.callback_data).toBe('setup:imessage');
    expect(getPrefs(U).canDm).toBe(true);
  });

  it('opens Mini App screens for the group it found, never more than 3 buttons', async () => {
    seedGroup(G);
    seed.pending(U, G);
    await send(U, '/setup');
    const b = buttons(last());
    expect(b.map((x) => x.text)).toEqual(['Add my details', 'Connect calendar', 'Connect Canvas']);
    expect(b[0]!.url).toContain('startapp=g9401_form');
    expect(b[1]!.url).toContain('startapp=g9401_calendar');
    expect(b[2]!.url).toContain('startapp=g9401_canvas');
  });

  it('drops a button as each step is done, and says all set with none left', async () => {
    seedGroup(G);
    seed.member(U, G);
    seed.calendar(U);
    seed.feed(U);
    await send(U, '/setup');
    expect(buttons(last()).map((x) => x.text)).toEqual(['Link iMessage']);
    seed.link(U);
    await send(U, '/setup');
    const text = String(last().payload.text);
    expect(text).toContain('6 of 6 done');
    expect(text).toContain(copy.ALL_SET);
    expect(buttons(last())).toEqual([]);
  });

  it('[Link iMessage] runs the /imessage flow', async () => {
    await bot.handleUpdate({
      update_id: updateId++,
      callback_query: { id: 'q', from: { id: U, is_bot: false, first_name: 'Ana' }, chat_instance: 'x', data: 'setup:imessage', message: { message_id: 1, date: 0, chat: { id: U, type: 'private', first_name: 'Ana' } } },
    } as Update);
    expect(String(last().payload.text)).toMatch(/Then text Cubbie: <code>Groupie link [A-Z0-9]{6}<\/code>/);
  });
});

describe('/start in a DM', () => {
  it('leads with the checklist, keeps the add-to-group button and points at /help', async () => {
    seedGroup(G);
    seed.pending(U, G);
    await send(U, '/start');
    const text = String(last().payload.text);
    expect(text.startsWith('<b>Your setup:</b>')).toBe(true);
    expect(text).toContain('✅ Reminders on');
    expect(text).toContain(copy.START_HELP_LINE);
    const b = buttons(last());
    expect(b.length).toBeLessThanOrEqual(4);
    expect(b.at(-1)!.url).toContain('startgroup=true');
  });

  it('/start imessage sends the link code', async () => {
    await send(U, '/start imessage');
    expect(String(last().payload.text)).toContain('Groupie link');
  });

  it('/start reminders is unchanged', async () => {
    await send(U, '/start reminders');
    expect(last().payload.text).toBe(copy.REMINDERS_READY);
    expect(last().payload.reply_markup).toBeUndefined();
  });
});

describe('/setup in a group', () => {
  it('still asks for the team size while setting up', async () => {
    seedGroup(G, 'setup');
    db.update(schema.groups).set({ teamSize: null }).run();
    await send(G, '/setup');
    expect(String(last().payload.text)).toBe(copy.askSizeText('Groupie'));
  });

  it('shows the state and [Add my details] while people are joining', async () => {
    seedGroup(G);
    db.update(schema.groups).set({ assignmentTitle: 'Sprint 3', nickname: 'Motu' }).run();
    seed.member(U, G);
    await send(G, '/setup');
    const text = String(last().payload.text);
    expect(text).toBe(
      ["<b>Motu here.</b> Here's where we're at:", '• Team of 4', '• Assignment: Sprint 3', '• 1 of 4 joined', '• Meeting: not picked yet'].join('\n'),
    );
    expect(buttons(last()).map((x) => [x.text, x.url])).toEqual([['Add my details', expect.stringContaining('_form')]]);
  });

  it('asks for availability after the split, and just opens the app once a meeting is picked', async () => {
    seedGroup(G, 'scheduling');
    await send(G, '/setup');
    expect(buttons(last()).map((x) => [x.text, x.url])).toEqual([['Fill your availability', expect.stringContaining('_avail')]]);
    db.update(schema.groups).set({ status: 'active' }).run();
    db.insert(schema.meetings).values({ groupId: G, start: '2026-11-02T22:00:00.000Z', end: '2026-11-02T23:00:00.000Z' }).run();
    await send(G, '/setup');
    expect(String(last().payload.text)).toMatch(/• Meeting: \S/);
    expect(String(last().payload.text)).not.toContain('not picked yet');
    expect(buttons(last()).map((x) => [x.text, x.url])).toEqual([['Open Groupie', expect.stringContaining('_home')]]);
  });
});
