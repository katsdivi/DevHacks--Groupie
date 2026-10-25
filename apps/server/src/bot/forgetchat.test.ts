import { Bot } from 'grammy';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db, schema } from '../db/index.ts';
import { appendDm, loadDm } from '../dmHistory.ts';
import { history } from '../agent.ts';
import { upsertMember } from '../members.ts';
import type { Member } from '../db/schema.ts';
import { dmComposer, FORGOT_CHAT } from './dm.ts';

const ME = 9401;
const OTHER = 9402;
const G = -990001;
const sent: { method: string; payload: Record<string, unknown> }[] = [];
const bot = new Bot('1:test');
let mine: Member;
let theirs: Member;

beforeAll(() => {
  bot.botInfo = { id: 1, is_bot: true, first_name: 'Groupie', username: 'CubbieGroupieBot' } as typeof bot.botInfo;
  // Capture outgoing calls instead of hitting Telegram.
  bot.api.config.use(async (_prev, method, payload) => {
    sent.push({ method, payload: payload as Record<string, unknown> });
    return { ok: true, result: { message_id: 1, date: 0, chat: { id: ME, type: 'private' } } } as never;
  });
  bot.filter((ctx) => ctx.chat?.type === 'private').use(dmComposer);
  db.insert(schema.groups).values({ id: G, title: 't', nickname: 'Motu', status: 'active', tz: 'America/Phoenix', createdAt: 'x' }).run();
  mine = upsertMember(G, ME, { name: 'Me', skills: [], weak_areas: [] });
  theirs = upsertMember(G, OTHER, { name: 'Other', skills: [], weak_areas: [] });
});
beforeEach(() => {
  sent.length = 0;
  for (const [uid, m] of [[ME, mine], [OTHER, theirs]] as const) {
    appendDm(uid, 'user', `dm ${uid}`);
    db.insert(schema.agentMessages).values({ memberId: m.id, role: 'user', content: `app ${uid}`, createdAt: 'x' }).run();
  }
});

const command = (text: string, chat: { id: number; type: 'private' } | { id: number; type: 'group'; title: string }) =>
  bot.handleUpdate({
    update_id: 1,
    message: {
      message_id: 1,
      date: 0,
      chat,
      from: { id: ME, is_bot: false, first_name: 'Me' },
      text,
      entities: [{ type: 'bot_command', offset: 0, length: text.split(' ')[0]!.length }],
    } as never,
  });

describe('/forgetchat', () => {
  it("wipes the sender's Telegram DM only and confirms", async () => {
    await command('/forgetchat', { id: ME, type: 'private' });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.payload.text).toBe(FORGOT_CHAT);
    expect(FORGOT_CHAT).toBe('Done. Our chat is wiped; your tasks and reminders are untouched.');
    expect(loadDm(ME)).toEqual([]);
    expect(history(mine.id)).toHaveLength(1);
    expect(loadDm(OTHER)).toHaveLength(1);
    expect(history(theirs.id)).toHaveLength(1);
  });

  it('does nothing in a group', async () => {
    await command('/forgetchat', { id: G, type: 'group', title: 't' });
    expect(sent).toHaveLength(0);
    expect(loadDm(ME).length).toBeGreaterThan(0);
  });
});
