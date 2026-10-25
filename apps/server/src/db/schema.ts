import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';

export const groups = sqliteTable('groups', {
  id: integer('id').primaryKey(), // Telegram chat id
  title: text('title').notNull().default(''),
  nickname: text('nickname').notNull().default('Groupie'),
  teamSize: integer('team_size'),
  status: text('status', { enum: ['setup', 'collecting_members', 'split_ready', 'scheduling', 'active'] })
    .notNull()
    .default('setup'),
  assignmentTitle: text('assignment_title'),
  dueDate: text('due_date'),
  tz: text('tz').notNull(),
  statusMessageId: integer('status_message_id'),
  createdAt: text('created_at').notNull(),
  splitMessageId: integer('split_message_id'),
  availMessageId: integer('avail_message_id'),
  lastCheckinAt: text('last_checkin_at'),
  /** Canvas course name from a Cubbie import; scopes calendar items in group answers. */
  canvasCourse: text('canvas_course'),
  /** Optional: lock the meeting at this time even if not everyone has answered. */
  availDeadlineAt: text('avail_deadline_at'),
  /** The cubbie_imports row that gave this group its assignment (null for a dropped file). */
  canvasImportId: integer('canvas_import_id'),
  /** When a file was dropped in and attached to that Canvas import. */
  canvasFileAt: text('canvas_file_at'),
  /** Telegram file behind the current assignment (dropped in, or posted after a Cubbie import). */
  assignmentFileId: text('assignment_file_id'),
  assignmentFileName: text('assignment_file_name'),
  assignmentFileMime: text('assignment_file_mime'),
});

export const pendingInputs = sqliteTable(
  'pending_inputs',
  {
    groupId: integer('group_id').notNull(),
    tgUserId: integer('tg_user_id').notNull(),
    kind: text('kind', { enum: ['nickname', 'rename', 'meeting_link'] }).notNull(),
    expiresAt: text('expires_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.tgUserId] })],
);

export type Group = typeof groups.$inferSelect;

const json = (name: string) => text(name, { mode: 'json' }).$type<string[]>().notNull().default([]);

export const members = sqliteTable('members', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  groupId: integer('group_id').notNull(),
  tgUserId: integer('tg_user_id'),
  name: text('name').notNull(),
  email: text('email'),
  color: text('color').notNull(),
  skills: json('skills'),
  weakAreas: json('weak_areas'),
  isSeed: integer('is_seed', { mode: 'boolean' }).notNull().default(false),
  /** Opt-in: let the load-aware split go easier on this member in busy weeks. */
  shareWorkload: integer('share_workload', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
});

export const tasks = sqliteTable('tasks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  groupId: integer('group_id').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  effort: integer('effort').notNull(),
  skillTags: json('skill_tags'),
  assigneeMemberId: integer('assignee_member_id'),
  status: text('status', { enum: ['todo', 'on_track', 'stuck', 'done'] }).notNull().default('todo'),
  dueDate: text('due_date'),
});

export const availability = sqliteTable('availability', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  memberId: integer('member_id').notNull(),
  slotStart: text('slot_start').notNull(),
  slotEnd: text('slot_end').notNull(),
});

export const meetings = sqliteTable('meetings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  groupId: integer('group_id').notNull(),
  start: text('start').notNull(),
  end: text('end').notNull(),
  mode: text('mode', { enum: ['meet', 'zoom', 'in_person'] }),
  calendarEventId: text('calendar_event_id'),
  meetLink: text('meet_link'),
  pollId: text('poll_id'),
  pollMessageId: integer('poll_message_id'),
  createdAt: text('created_at'),
  location: text('location'),
  eventLink: text('event_link'),
});

export type Meeting = typeof meetings.$inferSelect;

export const swapRequests = sqliteTable('swap_requests', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  groupId: integer('group_id').notNull(),
  fromMemberId: integer('from_member_id').notNull(),
  taskId: integer('task_id').notNull(),
  toMemberId: integer('to_member_id'),
  status: text('status').notNull().default('pending'),
  createdAt: text('created_at').notNull(),
});

export const agentMessages = sqliteTable('agent_messages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  memberId: integer('member_id').notNull(),
  role: text('role', { enum: ['user', 'assistant'] }).notNull(),
  content: text('content').notNull(),
  createdAt: text('created_at').notNull(),
});

export const splitVotes = sqliteTable(
  'split_votes',
  {
    groupId: integer('group_id').notNull(),
    tgUserId: integer('tg_user_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.tgUserId] })],
);

export type Member = typeof members.$inferSelect;
export type Task = typeof tasks.$inferSelect;

export const cubbiePairCodes = sqliteTable('cubbie_pair_codes', {
  code: text('code').primaryKey(),
  telegramUserId: integer('telegram_user_id').notNull(),
  groupChatId: integer('group_chat_id'),
  expiresAt: text('expires_at').notNull(),
  usedAt: text('used_at'),
  createdAt: text('created_at').notNull(),
  /** 'import' sends an assignment; 'link' connects the student's Cubbie (iMessage) to Groupie. */
  purpose: text('purpose', { enum: ['import', 'link'] }).notNull().default('import'),
});

export const cubbieImports = sqliteTable('cubbie_imports', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  pairCode: text('pair_code'),
  telegramUserId: integer('telegram_user_id').notNull(),
  groupChatId: integer('group_chat_id'),
  /** The CubbieImportPayload as received (attachments' base64 stripped before storing). */
  payload: text('payload', { mode: 'json' }).notNull(),
  status: text('status', { enum: ['received', 'imported', 'failed'] }).notNull().default('received'),
  error: text('error'),
  createdAt: text('created_at').notNull(),
});

export const calendarFeeds = sqliteTable('calendar_feeds', {
  telegramUserId: integer('telegram_user_id').primaryKey(),
  /** AES-256-GCM, see FEED_ENCRYPTION_KEY. Never log or return this. */
  feedUrlEncrypted: text('feed_url_encrypted').notNull(),
  etag: text('etag'),
  lastModified: text('last_modified'),
  lastPolledAt: text('last_polled_at'),
  lastError: text('last_error'),
  failures: integer('failures').notNull().default(0),
  nextPollAt: text('next_poll_at'),
  createdAt: text('created_at').notNull(),
});

export const calendarEvents = sqliteTable('calendar_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  telegramUserId: integer('telegram_user_id').notNull(),
  uid: text('uid').notNull(),
  course: text('course'),
  title: text('title').notNull(),
  dueAt: text('due_at').notNull(),
  description: text('description'),
  url: text('url'),
  kind: text('kind', { enum: ['assignment', 'event'] }).notNull(),
  /** Set when the UID disappears from the feed. */
  removedAt: text('removed_at'),
  updatedAt: text('updated_at').notNull(),
});

export type CalendarEvent = typeof calendarEvents.$inferSelect;

/** Facts Groupie remembers about one person. Private unless they mark it shared with one group. */
export const userMemory = sqliteTable('user_memory', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  telegramUserId: integer('telegram_user_id').notNull(),
  key: text('key').notNull(),
  value: text('value').notNull(),
  source: text('source', { enum: ['chat', 'mini_app'] }).notNull(),
  visibility: text('visibility', { enum: ['private', 'group'] }).notNull().default('private'),
  /** Required when visibility is 'group': the one group that may see it. */
  groupChatId: integer('group_chat_id'),
  updatedAt: text('updated_at').notNull(),
});

export const userPrefs = sqliteTable('user_prefs', {
  telegramUserId: integer('telegram_user_id').primaryKey(),
  remindersEnabled: integer('reminders_enabled', { mode: 'boolean' }).notNull().default(true),
  /** Hours before a due time to send a reminder. */
  reminderOffsets: text('reminder_offsets', { mode: 'json' }).$type<number[]>().notNull().default([48, 24, 3]),
  quietStart: text('quiet_start').notNull().default('23:00'),
  quietEnd: text('quiet_end').notNull().default('08:00'),
  tz: text('tz').notNull().default('America/Phoenix'),
  /** True once they started the bot in a DM; false after Telegram refuses a DM (403). */
  canDm: integer('can_dm', { mode: 'boolean' }).notNull().default(false),
  updatedAt: text('updated_at').notNull(),
});

export const remindersSent = sqliteTable(
  'reminders_sent',
  {
    telegramUserId: integer('telegram_user_id').notNull(),
    itemKey: text('item_key').notNull(),
    offsetH: integer('offset_h').notNull(),
    sentAt: text('sent_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.telegramUserId, t.itemKey, t.offsetH] })],
);

export const calendarConnections = sqliteTable(
  'calendar_connections',
  {
    telegramUserId: integer('telegram_user_id').notNull(),
    kind: text('kind', { enum: ['google', 'ics'] }).notNull(),
    /** Google refresh token, AES-256-GCM. Never log or return. */
    tokenEncrypted: text('token_encrypted'),
    /** ICS secret address, AES-256-GCM. Never log or return. */
    icsUrlEncrypted: text('ics_url_encrypted'),
    lastSyncAt: text('last_sync_at'),
    lastError: text('last_error'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.telegramUserId, t.kind] })],
);

/** When someone is busy. Never titles, locations, or attendees. */
export const busyBlocks = sqliteTable('busy_blocks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  telegramUserId: integer('telegram_user_id').notNull(),
  startAt: text('start_at').notNull(),
  endAt: text('end_at').notNull(),
  source: text('source', { enum: ['google', 'ics', 'canvas'] }).notNull(),
});

export type UserMemory = typeof userMemory.$inferSelect;
export type UserPrefs = typeof userPrefs.$inferSelect;
export type BusyBlock = typeof busyBlocks.$inferSelect;

/** Cubbie (iMessage) links. Only the sha256 of the token is stored; the raw token lives in the student's Cubbie sandbox. */
export const cubbieLinks = sqliteTable('cubbie_links', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  telegramUserId: integer('telegram_user_id').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  createdAt: text('created_at').notNull(),
  lastUsedAt: text('last_used_at'),
  revokedAt: text('revoked_at'),
});

export type CubbieLink = typeof cubbieLinks.$inferSelect;

/** Step 18: the bot DM conversation, one row per turn side, keyed by the verified Telegram user id. */
export const dmMessages = sqliteTable('dm_messages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  telegramUserId: integer('telegram_user_id').notNull(),
  role: text('role', { enum: ['user', 'assistant'] }).notNull(),
  content: text('content').notNull(),
  createdAt: text('created_at').notNull(),
});

export type DmMessage = typeof dmMessages.$inferSelect;
