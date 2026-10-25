import { and, eq, gte, isNull, lt } from 'drizzle-orm';
import { DateTime } from 'luxon';
import type { CalendarStatusResponse } from '@groupie/shared';
import { db, schema } from './db/index.ts';
import { env } from './env.ts';
import { decryptSecret, encryptSecret, feedKey } from './canvas/crypto.ts';
import { BUSY_WINDOW_DAYS, busyBlockCount, replaceBusyBlocks, type BusyInterval } from './busy.ts';
import { googleUserAvailable, googleUserClient } from './googleUser.ts';
import { fetchIcsText, icsToBusy, IcsUrlError } from './icsBusy.ts';

const { calendarConnections, calendarEvents, busyBlocks } = schema;

export type CalendarKind = 'google' | 'ics';
export const CALENDAR_SYNC_INTERVAL_MS = 30 * 60 * 1000;
export const MAX_SYNC_BACKOFF_MS = 12 * 60 * 60 * 1000;
/** Canvas calendar_events store only a start (due_at), so a timed Canvas event blocks this long. */
export const CANVAS_EVENT_MS = 60 * 60 * 1000;
const DAY_MS = 86_400_000;

export type SyncResult = { ok: true; count: number } | { ok: false; error: string };

const REDACTED = '[link]';

/**
 * Error to a short message safe for `last_error` and logs: strips the given secrets, any URL, and
 * anything that looks like a token. Never includes event titles (we never read them).
 */
export function safeSyncError(err: unknown, secrets: (string | null | undefined)[] = []): string {
  const e = err as { name?: string; message?: string; cause?: { code?: string } };
  let msg =
    e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'Timed out reaching the calendar' : (e?.message ?? String(err));
  if (e?.cause?.code) msg += ` (${e.cause.code})`;
  for (const s of secrets) {
    if (!s) continue;
    msg = msg.split(s).join(REDACTED);
    try {
      const u = new URL(s);
      if (u.pathname.length > 1) msg = msg.split(u.pathname).join(REDACTED);
      msg = msg.split(u.host).join(REDACTED);
    } catch {
      // not a URL
    }
  }
  msg = msg
    .replace(/\b(?:https?|webcals?):\/\/[^\s"'<>]*/gi, REDACTED)
    .replace(/\b1\/\/[\w-]{10,}/g, '[token]')
    .replace(/\bya29\.[\w.-]+/g, '[token]');
  if (/invalid_grant/i.test(msg)) msg = 'Google access expired or was revoked. Connect Google Calendar again.';
  return msg.slice(0, 300);
}

/** Wait after the Nth failure in a row: 30 min, 1 h, 2 h, ... capped at 12 h. */
export const syncBackoffMs = (failures: number) => Math.min(MAX_SYNC_BACKOFF_MS, CALENDAR_SYNC_INTERVAL_MS * 2 ** Math.max(0, failures - 1));

// Backoff lives in memory (the table has no failure counter); a restart retries everything once.
const failures = new Map<string, { count: number; nextAt: number }>();
const inFlight = new Map<string, Promise<SyncResult>>();
const key = (uid: number, kind: string) => `${uid}:${kind}`;

export const getConnection = (telegramUserId: number, kind: CalendarKind) =>
  db
    .select()
    .from(calendarConnections)
    .where(and(eq(calendarConnections.telegramUserId, telegramUserId), eq(calendarConnections.kind, kind)))
    .get();

function upsertConnection(telegramUserId: number, kind: CalendarKind, secret: { tokenEncrypted?: string; icsUrlEncrypted?: string }) {
  const now = new Date().toISOString();
  const set = { tokenEncrypted: secret.tokenEncrypted ?? null, icsUrlEncrypted: secret.icsUrlEncrypted ?? null, lastError: null, lastSyncAt: null };
  db.insert(calendarConnections)
    .values({ telegramUserId, kind, createdAt: now, ...set })
    .onConflictDoUpdate({ target: [calendarConnections.telegramUserId, calendarConnections.kind], set })
    .run();
  failures.delete(key(telegramUserId, kind));
}

/** Encrypts and saves a Google refresh token (replacing any previous one). */
export const saveGoogleToken = (telegramUserId: number, refreshToken: string) =>
  upsertConnection(telegramUserId, 'google', { tokenEncrypted: encryptSecret(refreshToken) });

/** Encrypts and saves an already normalized ICS link. */
export const saveIcsUrl = (telegramUserId: number, url: string) => upsertConnection(telegramUserId, 'ics', { icsUrlEncrypted: encryptSecret(url) });

/** Forgets the connection's token or link and every busy block it produced. Google tokens are revoked best effort. */
export async function disconnect(telegramUserId: number, kind: CalendarKind) {
  const row = getConnection(telegramUserId, kind);
  db.transaction((tx) => {
    tx.delete(calendarConnections)
      .where(and(eq(calendarConnections.telegramUserId, telegramUserId), eq(calendarConnections.kind, kind)))
      .run();
    tx.delete(busyBlocks).where(and(eq(busyBlocks.telegramUserId, telegramUserId), eq(busyBlocks.source, kind))).run();
  });
  failures.delete(key(telegramUserId, kind));
  if (kind === 'google' && row?.tokenEncrypted) {
    try {
      await googleUserClient().revoke(decryptSecret(row.tokenEncrypted));
    } catch {
      console.warn(`Google revoke failed for user ${telegramUserId} (token already deleted here)`);
    }
  }
}

const windowFrom = (now: Date) => ({ from: now, to: new Date(now.getTime() + BUSY_WINDOW_DAYS * DAY_MS) });

async function fetchBlocks(telegramUserId: number, kind: CalendarKind, secret: string, now: Date): Promise<BusyInterval[]> {
  const { from, to } = windowFrom(now);
  if (kind === 'google') return googleUserClient().freeBusy(secret, from.toISOString(), to.toISOString());
  const { blocks, unsupportedRules } = icsToBusy(await fetchIcsText(secret), from, BUSY_WINDOW_DAYS);
  if (unsupportedRules) {
    console.log(`ICS sync for user ${telegramUserId}: ${unsupportedRules} repeating events use rules other than daily or weekly; only their first instance counts`);
  }
  return blocks;
}

async function doSync(telegramUserId: number, kind: CalendarKind, now: Date): Promise<SyncResult> {
  const row = getConnection(telegramUserId, kind);
  const stored = kind === 'google' ? row?.tokenEncrypted : row?.icsUrlEncrypted;
  if (!row || !stored) return { ok: false, error: 'not_connected' };
  let secret: string | null = null;
  try {
    try {
      secret = decryptSecret(stored);
    } catch {
      throw new Error(kind === 'google' ? 'Could not read the saved Google access. Connect again.' : 'Could not read the saved link. Paste it again.');
    }
    const blocks = await fetchBlocks(telegramUserId, kind, secret, now);
    // Disconnected while fetching: drop this result so no blocks come back.
    if (!getConnection(telegramUserId, kind)) {
      return { ok: false, error: 'not_connected' };
    }
    const count = replaceBusyBlocks(telegramUserId, kind, blocks);
    db.update(calendarConnections)
      .set({ lastSyncAt: new Date().toISOString(), lastError: null })
      .where(and(eq(calendarConnections.telegramUserId, telegramUserId), eq(calendarConnections.kind, kind)))
      .run();
    failures.delete(key(telegramUserId, kind));
    return { ok: true, count };
  } catch (err) {
    const error = err instanceof IcsUrlError ? err.message : safeSyncError(err, [secret]);
    const prev = failures.get(key(telegramUserId, kind))?.count ?? 0;
    failures.set(key(telegramUserId, kind), { count: prev + 1, nextAt: Date.now() + syncBackoffMs(prev + 1) });
    db.update(calendarConnections)
      .set({ lastError: error })
      .where(and(eq(calendarConnections.telegramUserId, telegramUserId), eq(calendarConnections.kind, kind)))
      .run();
    console.warn(`Calendar sync failed for user ${telegramUserId} (${kind}): ${error}`);
    return { ok: false, error };
  }
}

/** Syncs one connection now (ignores backoff). Concurrent calls share one run. Never throws. */
export function syncConnection(telegramUserId: number, kind: CalendarKind, now = new Date()): Promise<SyncResult> {
  const k = key(telegramUserId, kind);
  const running = inFlight.get(k);
  if (running) return running;
  const p = doSync(telegramUserId, kind, now).finally(() => inFlight.delete(k));
  inFlight.set(k, p);
  return p;
}

/** True when a Canvas start time is local midnight, which is how all-day Canvas events arrive. */
const looksAllDay = (iso: string) => {
  const dt = DateTime.fromISO(iso, { zone: 'utc' }).setZone(env.defaultTz);
  return dt.hour === 0 && dt.minute === 0 && dt.second === 0;
};

/**
 * Canvas timed events (kind 'event', not assignment due dates) in the next 14 days become one hour
 * blocks (calendar_events stores only the start). All-day ones (local midnight) are skipped.
 */
export function syncCanvasBlocks(telegramUserId: number, now = new Date()): number {
  const { from, to } = windowFrom(now);
  const rows = db
    .select({ dueAt: calendarEvents.dueAt })
    .from(calendarEvents)
    .where(
      and(
        eq(calendarEvents.telegramUserId, telegramUserId),
        eq(calendarEvents.kind, 'event'),
        isNull(calendarEvents.removedAt),
        gte(calendarEvents.dueAt, new Date(from.getTime() - CANVAS_EVENT_MS).toISOString()),
        lt(calendarEvents.dueAt, to.toISOString()),
      ),
    )
    .all();
  const blocks = rows
    .filter((r) => !looksAllDay(r.dueAt))
    .map((r) => {
      const s = new Date(r.dueAt).getTime();
      return { start: new Date(s).toISOString(), end: new Date(s + CANVAS_EVENT_MS).toISOString() };
    });
  return replaceBusyBlocks(telegramUserId, 'canvas', blocks);
}

/** Syncs everything the user has: Google, ICS, and Canvas-derived blocks. */
export async function syncUser(telegramUserId: number, now = new Date()) {
  for (const kind of ['google', 'ics'] as const) if (getConnection(telegramUserId, kind)) await syncConnection(telegramUserId, kind, now);
  syncCanvasBlocks(telegramUserId, now);
}

/** Status for the Mini App. Never includes links or tokens. */
export function calendarStatus(telegramUserId: number): CalendarStatusResponse {
  const connections = (['google', 'ics'] as const).map((kind) => {
    const row = getConnection(telegramUserId, kind);
    const connected = Boolean(kind === 'google' ? row?.tokenEncrypted : row?.icsUrlEncrypted);
    return {
      kind,
      connected,
      last_sync_at: connected ? (row?.lastSyncAt ?? null) : null,
      last_error: connected && row?.lastError ? safeSyncError(new Error(row.lastError)) : null,
    };
  });
  return { google_available: googleUserAvailable(), connections, busy_block_count: busyBlockCount(telegramUserId) };
}

/** One pass: every due connection (respecting backoff), then Canvas blocks for everyone with Canvas data. */
export async function syncAll(now = new Date()) {
  const rows = db.select({ id: calendarConnections.telegramUserId, kind: calendarConnections.kind }).from(calendarConnections).all();
  for (const r of rows) {
    const f = failures.get(key(r.id, r.kind));
    if (f && f.nextAt > now.getTime()) continue;
    await syncConnection(r.id, r.kind, now);
  }
  const canvasUsers = new Set<number>([
    ...db.selectDistinct({ id: calendarEvents.telegramUserId }).from(calendarEvents).where(eq(calendarEvents.kind, 'event')).all().map((r) => r.id),
    ...db.selectDistinct({ id: busyBlocks.telegramUserId }).from(busyBlocks).where(eq(busyBlocks.source, 'canvas')).all().map((r) => r.id),
  ]);
  for (const id of canvasUsers) {
    try {
      syncCanvasBlocks(id, now);
    } catch (err) {
      console.warn(`Canvas busy sync failed for user ${id}: ${safeSyncError(err)}`);
    }
  }
  return { connections: rows.length, canvasUsers: canvasUsers.size };
}

/** Test helper: forget backoff state. */
export const resetSyncState = () => failures.clear();

/** Starts the background sync (every 30 min by default). Returns the timer, or null when encryption is off. */
export function startCalendarSync(intervalMs = CALENDAR_SYNC_INTERVAL_MS): NodeJS.Timeout | null {
  if (!feedKey()) {
    console.log('Calendar busy sync is off (set FEED_ENCRYPTION_KEY to 32 bytes of base64)');
    return null;
  }
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await syncAll();
    } catch (err) {
      console.error('Calendar sync tick failed', safeSyncError(err));
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref();
  void tick();
  return timer;
}
