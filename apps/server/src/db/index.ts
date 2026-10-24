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
