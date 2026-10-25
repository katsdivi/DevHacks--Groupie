import { beforeEach, describe, expect, it } from 'vitest';
import { SetupStatus } from '@groupie/shared';
import { db, schema } from './db/index.ts';
import { seed, seedGroup, wipe } from './setupStatus.fixture.ts';
import { nextSteps, setupStatus } from './setupStatus.ts';

const U = 7701;
const G = -7701;
const done = (userId: number, groupId?: number) =>
  Object.fromEntries(setupStatus(userId, groupId).steps.map((s) => [s.key, s.done]));

beforeEach(wipe);

describe('setupStatus', () => {
  it('starts with nothing done and only the add-to-group and Cubbie steps actionable without a group', () => {
    const s = SetupStatus.parse(setupStatus(U));
    expect(s.done).toBe(0);
    expect(s.total).toBe(6);
    expect(s.group).toBeNull();
    expect(s.steps.map((x) => x.key)).toEqual(['group', 'details', 'calendar', 'canvas', 'imessage', 'reminders']);
    const next = nextSteps(s);
    expect(next.map((x) => x.key)).toEqual(['group', 'imessage', 'reminders']);
    expect(next[0]!.action).toEqual({ kind: 'url', url: expect.stringContaining('startgroup=true') });
    expect(s.steps.find((x) => x.key === 'imessage')!.action).toMatchObject({ kind: 'command', command: 'imessage', url: expect.stringContaining('start=imessage') });
  });

  it('ticks each step off from its own table', () => {
    seedGroup(G);
    expect(done(U)).toMatchObject({ group: false, details: false });
    seed.member(U, G);
    expect(done(U)).toMatchObject({ group: true, details: true, calendar: false });
    seed.calendar(U);
    expect(done(U)).toMatchObject({ calendar: true, canvas: false });
    seed.feed(U);
    expect(done(U)).toMatchObject({ canvas: true, imessage: false });
    seed.link(U);
    expect(done(U)).toMatchObject({ imessage: true, reminders: false });
    seed.dm(U);
    const s = setupStatus(U);
    expect(s.all_done).toBe(true);
    expect(s.done).toBe(6);
    expect(nextSteps(s)).toEqual([]);
    expect(s.steps.find((x) => x.key === 'group')!.label).toBe('In Team Alpha');
  });

  it('ignores a revoked Cubbie link and a calendar row with no secret', () => {
    seed.link(U, true);
    seed.calendar(U, null);
    expect(done(U)).toMatchObject({ imessage: false, calendar: false });
  });

  it('points details, calendar and Canvas at Mini App screens once there is a group', () => {
    seedGroup(G);
    const s = setupStatus(U, G);
    expect(s.group).toEqual({ id: G, title: 'Team Alpha' });
    const action = (k: string) => s.steps.find((x) => x.key === k)!.action;
    expect(action('details')).toEqual({ kind: 'screen', screen: 'form' });
    expect(action('calendar')).toEqual({ kind: 'screen', screen: 'calendar' });
    expect(action('canvas')).toEqual({ kind: 'screen', screen: 'canvas' });
  });

  it('holds the details step until the assignment is in', () => {
    seedGroup(G, 'setup');
    const s = setupStatus(U, G);
    const details = s.steps.find((x) => x.key === 'details')!;
    expect(details).toMatchObject({ done: false, action: { kind: 'none' }, label: 'Add your details once the assignment is in' });
    expect(nextSteps(s).map((x) => x.key)).toEqual(['calendar', 'canvas', 'imessage']);
  });

  it('never creates a prefs row just by reading', () => {
    setupStatus(U);
    expect(db.select().from(schema.userPrefs).all()).toEqual([]);
  });
});
