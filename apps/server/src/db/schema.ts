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
