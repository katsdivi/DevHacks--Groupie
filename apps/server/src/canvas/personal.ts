import { and, eq, isNull } from 'drizzle-orm';
import { DateTime } from 'luxon';
import type { CubbieImportPayload, ParsedAssignment } from '@groupie/shared';
import { db, schema } from '../db/index.ts';
import { bot } from '../bot/core.ts';
import { html } from '../bot/format.ts';
import { parseAssignment } from '../parse.ts';
import { PLAN_FAILED, PLAN_INTRO, PLAN_NO_DUE, PLAN_SAVED } from '../copy.ts';

/**
 * Personal Canvas import: a code made in a private chat (no group). The assignment becomes a step-by-step
 * plan for one person, sent by DM, and its due date lands in the student's own calendar items.
 */

const { calendarEvents } = schema;

/** Canvas at ASU shows times in Arizona time. */
export const CANVAS_TZ = 'America/Phoenix';
export const IMPORT_UID_PREFIX = 'cubbie-import-';

const EFFORT_LABEL: Record<number, string> = {
  1: 'under an hour',
  2: 'a couple of hours',
  3: 'half a day',
  5: 'a full day',
  8: 'several days',
};

/** "Fri Nov 20, 11:59 PM" in Canvas time, or null. */
export function canvasDueLabel(dueAt: string | null): string | null {
  if (!dueAt) return null;
  const d = DateTime.fromISO(dueAt, { setZone: true }).setZone(CANVAS_TZ);
  return d.isValid ? d.toFormat('ccc LLL d, h:mm a') : null;
}

export type PersonalResult = { plan: ParsedAssignment | null; calendarSaved: boolean };

/**
 * Adds the assignment to the student's calendar items (uid cubbie-import-<id>) so Upcoming, private chat and
 * reminders see it. Skips it when there is no due date, or when the Canvas feed already has the same item.
 */
export function saveImportToCalendar(telegramUserId: number, importId: number, p: CubbieImportPayload, now = new Date()): boolean {
  if (!p.assignment.dueAt) return false;
  const dueAt = new Date(p.assignment.dueAt).toISOString();
  const title = p.assignment.title;
  const twin = db
    .select()
    .from(calendarEvents)
    .where(and(eq(calendarEvents.telegramUserId, telegramUserId), isNull(calendarEvents.removedAt), eq(calendarEvents.dueAt, dueAt)))
    .all()
    .find((e) => e.title.trim().toLowerCase() === title.trim().toLowerCase());
  if (twin) return true;
  const fields = { course: p.course.name, title, dueAt, description: null, url: p.assignment.url ?? null, kind: 'assignment' as const };
  db.insert(calendarEvents)
    .values({ telegramUserId, uid: `${IMPORT_UID_PREFIX}${importId}`, ...fields, removedAt: null, updatedAt: now.toISOString() })
    .onConflictDoUpdate({ target: [calendarEvents.telegramUserId, calendarEvents.uid], set: { ...fields, updatedAt: now.toISOString() } })
    .run();
  return true;
}

/** The DM: title, course, due date, points, then the steps with effort. */
export function personalPlanText(p: CubbieImportPayload, plan: ParsedAssignment | null, calendarSaved: boolean): string {
  const a = p.assignment;
  const due = canvasDueLabel(a.dueAt);
  const facts = [
    due ? `Due ${due} (Arizona time)` : 'No due date in Canvas',
    a.pointsPossible != null ? `${a.pointsPossible} points` : null,
  ].filter(Boolean);
  const lines = [`<b>${html(a.title)}</b>`, html(p.course.name), facts.join(' · '), ''];
  if (plan) {
    lines.push(PLAN_INTRO);
    plan.tasks.forEach((t, i) => {
      lines.push(`${i + 1}. ${html(t.title)} <i>(${t.effort} pt, ${EFFORT_LABEL[t.effort] ?? 'some time'})</i>`);
      if (t.description) lines.push(`   ${html(t.description)}`);
    });
  } else {
    lines.push(PLAN_FAILED);
  }
  lines.push('');
  lines.push(
    calendarSaved ? PLAN_SAVED : PLAN_NO_DUE,
  );
  if (a.url) lines.push(a.url);
  return lines.join('\n');
}

/** Saves the calendar item, makes the plan (team of one), and DMs it. Never throws. */
export async function runPersonalImport(
  telegramUserId: number,
  importId: number,
  p: CubbieImportPayload,
  text: string,
  extraContext: string | undefined,
): Promise<PersonalResult> {
  let calendarSaved = false;
  try {
    calendarSaved = saveImportToCalendar(telegramUserId, importId, p);
  } catch (err) {
    console.error('Personal import calendar save failed', err);
  }
  let plan: ParsedAssignment | null = null;
  if (text.replace(/\s/g, '').length >= 50) {
    try {
      plan = await parseAssignment(text, 1, undefined, extraContext);
    } catch (err) {
      console.error('Personal import parse failed', err);
    }
  }
  await bot.api.sendMessage(telegramUserId, personalPlanText(p, plan, calendarSaved), { parse_mode: 'HTML' }).catch(() => {});
  return { plan, calendarSaved };
}
