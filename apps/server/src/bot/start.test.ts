import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db, schema } from '../db/index.ts';
import { getPrefs } from '../prefs.ts';
import { bot, REMINDERS_READY } from './index.ts';
import { featureGuide } from './guide.ts';

const USER = 9301;
const replies: { method: string; payload: Record<string, unknown> }[] = [];

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
  // Capture outgoing calls instead of hitting Telegram.
  bot.api.config.use(async (_prev, method, payload) => {
    replies.push({ method, payload: payload as Record<string, unknown> });
    return { ok: true, result: { message_id: 1, date: 0, chat: { id: USER, type: 'private' } } } as never;
  });
});
beforeEach(() => {
  replies.length = 0;
  db.delete(schema.userPrefs).run();
});

const start = (text: string) =>
  bot.handleUpdate({
    update_id: 1,
    message: {
      message_id: 1,
      date: 0,
      chat: { id: USER, type: 'private', first_name: 'Ana' },
      from: { id: USER, is_bot: false, first_name: 'Ana' },
      text,
      entities: [{ type: 'bot_command', offset: 0, length: 6 }],
    },
  });

describe('/start in a DM', () => {
  it('marks can_dm true from the reminders deep link and confirms', async () => {
    await start('/start reminders');
    expect(getPrefs(USER).canDm).toBe(true);
    expect(replies).toHaveLength(1);
    expect(replies[0]!.payload.text).toBe(REMINDERS_READY);
  });

  it('marks can_dm true on a plain /start and leads with the setup checklist', async () => {
    await start('/start');
    expect(getPrefs(USER).canDm).toBe(true);
    const text = String(replies[0]!.payload.text);
    expect(text).toContain('<b>Your setup:</b>');
    expect(text).toContain('✅ Reminders on');
    expect(text).toContain('/help');
    const buttons = JSON.stringify(replies[0]!.payload.reply_markup);
    expect(buttons).toContain('startgroup=true');
  });

  it('shows the same guide on /help, short enough for one phone screen', async () => {
    await start('/help');
    const text = String(replies.at(-1)!.payload.text);
    expect(text).toBe(featureGuide());
    expect(text.split('\n').length).toBeLessThanOrEqual(12);
    expect(text).toContain('stay private');
  });
});
