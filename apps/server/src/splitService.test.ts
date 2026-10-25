import { afterEach, describe, expect, it } from 'vitest';
import { db, schema } from './db/index.ts';
import { env } from './env.ts';
import { busyLabels, computeSplit, memberLoads, splitCardData, splitView } from './splitService.ts';
import { splitCardHtml } from './cards/splitCard.ts';

const created = new Date().toISOString();
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
const G = -2001;
db.insert(schema.groups).values({ id: G, title: 'Team', tz: 'America/Phoenix', createdAt: created, assignmentTitle: 'Project 2' }).run();
const add = (tgUserId: number | null, name: string) =>
  db.insert(schema.members).values({ groupId: G, tgUserId, name, color: '#FFB547', createdAt: created }).returning().get();
const busy = add(21, 'Busy');
const free = add(22, 'Free');
add(null, 'Seed');
// 3 + 2 + 2 + 3 + 3 = 13 points over 3 members: best is 5/5/3, so somebody gets the light share.
for (const [title, effort] of [['A', 3], ['B', 2], ['C', 2], ['D', 3], ['E', 3]] as const) {
  db.insert(schema.tasks).values({ groupId: G, title, effort }).run();
}
let uid = 0;
for (const d of [1, 2, 3, 4]) {
  db.insert(schema.calendarEvents)
    .values({ telegramUserId: 21, uid: `b${++uid}`, course: 'HST 101', title: `Busy item ${d}`, dueAt: inDays(d), kind: 'assignment', updatedAt: created })
    .run();
}

afterEach(() => {
  env.loadAwareSplit = false;
});

describe('load-aware split wiring', () => {
  it('scores members by their own calendars', () => {
    const loads = memberLoads(G);
    expect(loads[busy.id]).toEqual({ score: 8, dueSoon: 4 });
    expect(loads[free.id]).toEqual({ score: 0, dueSoon: 0 });
  });

  it('keeps the same balance and gives the light share to the busy member when the flag is on', () => {
    const off = computeSplit(G);
    env.loadAwareSplit = true;
    const on = computeSplit(G);
    expect(on.maxGap).toBeLessThanOrEqual(off.maxGap);
    expect(on.totals[busy.id]).toBe(3);
    expect(Object.values(on.totals).sort()).toEqual([3, 5, 5]);
  });

  it('tags busy members on the card only when the flag is on', () => {
    const view = splitView(G, null, computeSplit(G));
    expect(busyLabels(G)).toEqual({});
    expect(splitCardData(view).members.some((m) => m.busyLabel)).toBe(false);
    env.loadAwareSplit = true;
    const data = splitCardData(view);
    expect(data.members.find((m) => m.name === 'Busy')?.busyLabel).toBe('Busy week · 4 due');
    expect(data.members.find((m) => m.name === 'Free')?.busyLabel).toBeUndefined();
    const html = splitCardHtml(data);
    expect(html).toContain('<span class="busy"><i></i>Busy week · 4 due</span>');
    expect(html).not.toContain('Busy item');
  });
});
