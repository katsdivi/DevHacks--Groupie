import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { env } from '../env.ts';
import * as schema from './schema.ts';

// Each entry runs once, tracked by PRAGMA user_version. Only ever append.
const MIGRATIONS = [
  `CREATE TABLE groups (
     id INTEGER PRIMARY KEY,
     title TEXT NOT NULL DEFAULT '',
     nickname TEXT NOT NULL DEFAULT 'Groupie',
     team_size INTEGER,
     status TEXT NOT NULL DEFAULT 'setup',
     assignment_title TEXT,
     due_date TEXT,
     tz TEXT NOT NULL,
     status_message_id INTEGER,
     created_at TEXT NOT NULL
   );
   CREATE TABLE pending_inputs (
     group_id INTEGER NOT NULL,
     tg_user_id INTEGER NOT NULL,
     kind TEXT NOT NULL,
     expires_at TEXT NOT NULL,
     PRIMARY KEY (group_id, tg_user_id)
   );`,
  `CREATE TABLE members (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE ON UPDATE CASCADE,
     tg_user_id INTEGER,
     name TEXT NOT NULL,
     email TEXT,
     color TEXT NOT NULL,
     skills TEXT NOT NULL DEFAULT '[]',
     weak_areas TEXT NOT NULL DEFAULT '[]',
     is_seed INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL
   );
   CREATE UNIQUE INDEX members_group_user ON members(group_id, tg_user_id) WHERE tg_user_id IS NOT NULL;
   CREATE TABLE tasks (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE ON UPDATE CASCADE,
     title TEXT NOT NULL,
     description TEXT NOT NULL DEFAULT '',
     effort INTEGER NOT NULL,
     skill_tags TEXT NOT NULL DEFAULT '[]',
     assignee_member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
     status TEXT NOT NULL DEFAULT 'todo',
     due_date TEXT
   );
   CREATE TABLE availability (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
     slot_start TEXT NOT NULL,
     slot_end TEXT NOT NULL,
     UNIQUE (member_id, slot_start)
   );
   CREATE TABLE meetings (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE ON UPDATE CASCADE,
     start TEXT NOT NULL,
     end TEXT NOT NULL,
     mode TEXT,
     calendar_event_id TEXT,
     meet_link TEXT
   );
   CREATE TABLE swap_requests (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE ON UPDATE CASCADE,
     from_member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
     task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
     to_member_id INTEGER REFERENCES members(id) ON DELETE CASCADE,
     status TEXT NOT NULL DEFAULT 'pending',
     created_at TEXT NOT NULL
   );
   CREATE TABLE agent_messages (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
     role TEXT NOT NULL,
     content TEXT NOT NULL,
     created_at TEXT NOT NULL
   );`,
  `ALTER TABLE groups ADD COLUMN split_message_id INTEGER;
   CREATE TABLE split_votes (
     group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE ON UPDATE CASCADE,
     tg_user_id INTEGER NOT NULL,
     PRIMARY KEY (group_id, tg_user_id)
   );`,
  `ALTER TABLE groups ADD COLUMN avail_message_id INTEGER;
   ALTER TABLE meetings ADD COLUMN poll_id TEXT;
   ALTER TABLE meetings ADD COLUMN poll_message_id INTEGER;
   ALTER TABLE meetings ADD COLUMN created_at TEXT;
   CREATE INDEX availability_member ON availability(member_id);`,
  `ALTER TABLE meetings ADD COLUMN location TEXT;
   ALTER TABLE meetings ADD COLUMN event_link TEXT;`,
];

export function openDb(file: string) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const current = sqlite.pragma('user_version', { simple: true }) as number;
  for (let v = current; v < MIGRATIONS.length; v++) {
    sqlite.transaction(() => {
      sqlite.exec(MIGRATIONS[v]);
      sqlite.pragma(`user_version = ${v + 1}`);
    })();
  }
  return drizzle(sqlite, { schema });
}

export type Db = ReturnType<typeof openDb>;
export const db = openDb(env.databasePath);
export { schema };
