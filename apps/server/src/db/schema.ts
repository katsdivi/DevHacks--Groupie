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
});

export const pendingInputs = sqliteTable(
  'pending_inputs',
  {
    groupId: integer('group_id').notNull(),
    tgUserId: integer('tg_user_id').notNull(),
    kind: text('kind', { enum: ['nickname', 'rename'] }).notNull(),
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
});

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
