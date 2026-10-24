import { skillFit, type SplitConstraints, type SplitMember, type SplitResult, type SplitTask } from './split.ts';

export type SwapPlan = SplitResult & { changed: number };

/**
 * Plans a swap that disturbs as few tasks as possible: the task leaves `fromId` (to `toId`, or to
 * whoever fits best), then up to two compensating moves rebalance. Ranked by gap, then number of
 * tasks that change hands, then skill fit. Locked tasks and forbidden pairs are respected.
 */
export function planSwap(
  tasks: SplitTask[],
  members: SplitMember[],
  current: Record<number, number>,
  taskId: number,
  fromId: number,
  toId: number | null,
  constraints: SplitConstraints = {},
): SwapPlan | null {
  const ids = members.map((m) => m.id).sort((a, b) => a - b);
  const byId = new Map(members.map((m) => [m.id, m]));
  const forbidden = new Set((constraints.forbidden ?? []).map((f) => `${f.task_id}:${f.member_id}`));
  const locked = constraints.locked ?? {};
  const allowed = (t: number, m: number) => !forbidden.has(`${t}:${m}`);

  const recipients = (toId === null ? ids.filter((m) => m !== fromId) : [toId]).filter((m) => allowed(taskId, m));
  if (!recipients.length) return null;

  const evaluate = (owner: Record<number, number>) => {
    const totals: Record<number, number> = Object.fromEntries(ids.map((m) => [m, 0]));
    let fit = 0;
    for (const t of tasks) {
      totals[owner[t.id]!] = (totals[owner[t.id]!] ?? 0) + t.effort;
      const m = byId.get(owner[t.id]!);
      if (m) fit += skillFit(t, m);
    }
    const vals = Object.values(totals);
    const changed = tasks.filter((t) => owner[t.id] !== current[t.id]).length;
    return { totals, maxGap: Math.max(...vals) - Math.min(...vals), changed, fit };
  };

  type Cand = ReturnType<typeof evaluate> & { owner: Record<number, number> };
  let best: Cand | null = null;
  const consider = (owner: Record<number, number>) => {
    const e = { ...evaluate(owner), owner: { ...owner } };
    if (
      !best ||
      e.maxGap < best.maxGap ||
      (e.maxGap === best.maxGap && (e.changed < best.changed || (e.changed === best.changed && e.fit > best.fit)))
    ) {
      best = e;
    }
  };

  const movable = tasks.filter((t) => t.id !== taskId && locked[t.id] === undefined).map((t) => t.id);
  for (const r of recipients) {
    const base = { ...current, [taskId]: r };
    consider(base);
    for (const a of movable) {
      for (const ma of ids) {
        if (ma === base[a] || !allowed(a, ma)) continue;
        const one = { ...base, [a]: ma };
        consider(one);
        for (const b of movable) {
          if (b <= a) continue;
          for (const mb of ids) {
            if (mb === one[b] || !allowed(b, mb)) continue;
            consider({ ...one, [b]: mb });
          }
        }
      }
    }
  }
  if (!best) return null;
  const chosen: Cand = best;
  return { assignments: chosen.owner, totals: chosen.totals, maxGap: chosen.maxGap, changed: chosen.changed };
}
