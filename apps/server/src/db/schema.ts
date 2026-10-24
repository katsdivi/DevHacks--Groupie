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
