import { and, eq, isNotNull, or } from 'drizzle-orm';
import type { SetupAction, SetupStatus, SetupStep } from '@groupie/shared';
import { db, schema } from './db/index.ts';
import { env } from './env.ts';
import { getGroup, type Group } from './groups.ts';
import { getMemberByTgUser } from './members.ts';
import { isLinked, projectGroupsFor } from './membership.ts';
import { getFeed } from './canvas/feeds.ts';
import { startLink } from './prefs.ts';
import { IMESSAGE_HINT, SETUP_BUTTON, SETUP_STEP } from './copy.ts';

/**
 * The personal setup checklist for one Telegram user, read from the DB only (no writes, no model, no
 * Telegram calls). Keyed by the verified Telegram user id. Nothing here goes to the LLM.
 */

const { calendarConnections, userPrefs } = schema;

/** Opens Telegram's "add to group" picker for this bot. */
export const addToGroupUrl = () => `https://t.me/${env.botUsername}?startgroup=true`;
/** Opens the bot DM and runs the existing /imessage link flow (`/start imessage`). */
export const imessageStartUrl = () => `https://t.me/${env.botUsername}?start=imessage`;

/** Google or ICS with its secret still saved (same test as calendarStatus). Canvas alone does not count. */
function calendarConnected(userId: number): boolean {
  const c = calendarConnections;
  return !!db
    .select({ k: c.kind })
    .from(c)
    .where(and(eq(c.telegramUserId, userId), or(isNotNull(c.tokenEncrypted), isNotNull(c.icsUrlEncrypted))))
    .get();
}

/** Whether Telegram lets us DM them. Read without creating a prefs row. */
const canDm = (userId: number) =>
  !!db.select({ canDm: userPrefs.canDm }).from(userPrefs).where(eq(userPrefs.telegramUserId, userId)).get()?.canDm;

/** The group the checklist is about: the one asked for, else the first joined, else the newest pending. */
function pickGroup(userId: number, groupId?: number): Group | null {
  if (groupId != null) return getGroup(groupId) ?? null;
  return projectGroupsFor(userId)[0]?.group ?? null;
}

const NONE: SetupAction = { kind: 'none' };

/**
 * `groupId` is the group the caller is looking at (the Mini App); a DM leaves it out. Steps come in the order
 * a student should do them, so the first undone step with an action is the next one.
 */
export function setupStatus(userId: number, groupId?: number): SetupStatus {
  const group = pickGroup(userId, groupId);
  const screen = (s: 'form' | 'calendar' | 'canvas'): SetupAction => (group ? { kind: 'screen', screen: s } : NONE);
  const step = (key: SetupStep['key'], done: boolean, label: string, action: SetupAction, hint: string | null = null): SetupStep => ({
    key,
    done,
    label,
    button: SETUP_BUTTON[key],
    hint: done ? null : hint,
    action: done ? NONE : action,
  });

  const member = group ? getMemberByTgUser(group.id, userId) : undefined;
  const waiting = !member && group?.status === 'setup';
  const calendar = calendarConnected(userId);
  const canvas = !!getFeed(userId);
  const linked = isLinked(userId);
  const dm = canDm(userId);
  const steps: SetupStep[] = [
    step('group', !!group, group ? SETUP_STEP.group.done(group.title) : SETUP_STEP.group.todo, { kind: 'url', url: addToGroupUrl() }),
    step(
      'details',
      !!member,
      member ? SETUP_STEP.details.done : waiting ? SETUP_STEP.details.waiting : SETUP_STEP.details.todo,
      waiting ? NONE : screen('form'),
    ),
    step('calendar', calendar, calendar ? SETUP_STEP.calendar.done : SETUP_STEP.calendar.todo, screen('calendar')),
    step('canvas', canvas, canvas ? SETUP_STEP.canvas.done : SETUP_STEP.canvas.todo, screen('canvas')),
    step(
      'imessage',
      linked,
      linked ? SETUP_STEP.imessage.done : SETUP_STEP.imessage.todo,
      { kind: 'command', command: 'imessage', url: imessageStartUrl() },
      IMESSAGE_HINT,
    ),
    step('reminders', dm, dm ? SETUP_STEP.reminders.done : SETUP_STEP.reminders.todo, { kind: 'url', url: startLink() }),
  ];
  const done = steps.filter((s) => s.done).length;
  return {
    group: group ? { id: group.id, title: group.title } : null,
    steps,
    done,
    total: steps.length,
    all_done: done === steps.length,
  };
}

/** The next undone steps that can be acted on now, at most `max`. */
export const nextSteps = (status: SetupStatus, max = 3) => status.steps.filter((s) => !s.done && s.action.kind !== 'none').slice(0, max);
