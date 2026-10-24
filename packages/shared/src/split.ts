export type SplitTask = { id: number; effort: number; skill_tags: string[] };
export type SplitMember = { id: number; skills: string[]; weak_areas: string[] };
export type SplitConstraints = {
  /** taskId -> memberId that must keep it */
  locked?: Record<number, number>;
  /** pairs that must never be assigned (from swap requests) */
  forbidden?: { task_id: number; member_id: number }[];
};
export type SplitResult = {
  /** taskId -> memberId */
  assignments: Record<number, number>;
  /** memberId -> total effort points (every member present, 0 if none) */
  totals: Record<number, number>;
  /** max total minus min total across all members */
  maxGap: number;
};

const MAX_ITERATIONS = 500;
const RESTARTS = 40;

/** Small seeded PRNG so restarts stay deterministic. */
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** +1 per task tag the member is good at, -1 per tag in their weak areas. */
export function skillFit(task: SplitTask, member: SplitMember): number {
  let score = 0;
  for (const tag of task.skill_tags) {
    if (member.skills.includes(tag)) score += 1;
    if (member.weak_areas.includes(tag)) score -= 1;
  }
  return score;
}

/** Lower is better: max gap first, then skill fit (higher), then spread (sum of squared totals). */
type Key = [gap: number, negFit: number, sumSq: number];

const better = (a: Key, b: Key) => a[0] !== b[0] ? a[0] < b[0] : a[1] !== b[1] ? a[1] < b[1] : a[2] < b[2];

type State = { owner: number[]; totals: number[]; fit: number };

/**
 * Splits tasks across members so effort totals are as even as possible.
 * Greedy (largest first, to the lightest member) followed by local search over moves and swaps,
 * with a few seeded restarts to escape plateaus.
 * Deterministic: tasks and members are sorted by id internally, so input order doesn't matter.
 */
export function split(tasks: SplitTask[], members: SplitMember[], constraints: SplitConstraints = {}): SplitResult {
  const ms = [...members].sort((a, b) => a.id - b.id).filter((m, i, arr) => i === 0 || arr[i - 1]!.id !== m.id);
  if (ms.length === 0) return { assignments: {}, totals: {}, maxGap: 0 };
  const ts = [...tasks].sort((a, b) => a.id - b.id);
  const nM = ms.length;
  const memberIndex = new Map(ms.map((m, i) => [m.id, i]));

  const forbidden = new Set((constraints.forbidden ?? []).map((f) => `${f.task_id}:${f.member_id}`));
  // allowed[t][m]; a task forbidden for everyone is allowed everywhere so it is never dropped.
  const allowed = ts.map((t) => {
    const row = ms.map((m) => !forbidden.has(`${t.id}:${m.id}`));
    return row.some(Boolean) ? row : row.map(() => true);
  });
  const locked = ts.map((t) => {
    const memberId = constraints.locked?.[t.id];
    return memberId === undefined ? -1 : (memberIndex.get(memberId) ?? -1);
  });
  const fit = ts.map((t) => ms.map((m) => skillFit(t, m)));

  const order = ts
    .map((_, i) => i)
    .filter((i) => locked[i] === -1)
    .sort((a, b) => ts[b]!.effort - ts[a]!.effort || ts[a]!.id - ts[b]!.id);

  const greedy = (useFit: boolean, taskOrder: number[] = order): State => {
    const owner = ts.map(() => -1);
    const totals = ms.map(() => 0);
    ts.forEach((t, i) => {
      if (locked[i] !== -1) {
        owner[i] = locked[i]!;
        totals[locked[i]!]! += t.effort;
      }
    });
    for (const i of taskOrder) {
      let best = -1;
      for (let m = 0; m < nM; m++) {
        if (!allowed[i]![m]) continue;
        if (best === -1 || totals[m]! < totals[best]!) best = m;
        else if (totals[m] === totals[best] && useFit && fit[i]![m]! > fit[i]![best]!) best = m;
      }
      owner[i] = best;
      totals[best]! += ts[i]!.effort;
    }
    return { owner, totals, fit: owner.reduce((s, m, i) => s + fit[i]![m]!, 0) };
  };

  const keyOf = (totals: number[], totalFit: number): Key => {
    let max = -Infinity;
    let min = Infinity;
    let sq = 0;
    for (const v of totals) {
      if (v > max) max = v;
      if (v < min) min = v;
      sq += v * v;
    }
    return [max - min, -totalFit, sq];
  };

  const improve = (s: State): State => {
    const { owner, totals } = s;
    let totalFit = s.fit;
    let current = keyOf(totals, totalFit);
    const movable = ts.map((_, i) => i).filter((i) => locked[i] === -1);

    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      let bestKey = current;
      let bestMove: (() => void) | null = null;

      // Single-task moves.
      for (const i of movable) {
        const from = owner[i]!;
        const e = ts[i]!.effort;
        for (let to = 0; to < nM; to++) {
          if (to === from || !allowed[i]![to]) continue;
          totals[from]! -= e;
          totals[to]! += e;
          const f = totalFit - fit[i]![from]! + fit[i]![to]!;
          const k = keyOf(totals, f);
          totals[from]! += e;
          totals[to]! -= e;
          if (better(k, bestKey)) {
            bestKey = k;
            bestMove = () => {
              owner[i] = to;
              totals[from]! -= e;
              totals[to]! += e;
              totalFit = f;
            };
          }
        }
      }

      // Pairwise swaps between two members.
      for (let x = 0; x < movable.length; x++) {
        const i = movable[x]!;
        for (let y = x + 1; y < movable.length; y++) {
          const j = movable[y]!;
          const a = owner[i]!;
          const b = owner[j]!;
          if (a === b || !allowed[i]![b] || !allowed[j]![a]) continue;
          const d = ts[i]!.effort - ts[j]!.effort;
          totals[a]! -= d;
          totals[b]! += d;
          const f = totalFit - fit[i]![a]! - fit[j]![b]! + fit[i]![b]! + fit[j]![a]!;
          const k = keyOf(totals, f);
          totals[a]! += d;
          totals[b]! -= d;
          if (better(k, bestKey)) {
            bestKey = k;
            bestMove = () => {
              owner[i] = b;
              owner[j] = a;
              totals[a]! -= d;
              totals[b]! += d;
              totalFit = f;
            };
          }
        }
      }

      if (!bestMove) break;
      bestMove();
      current = bestKey;
    }
    return { owner, totals, fit: totalFit };
  };

  // Searching from both a skill-aware and a plain greedy start guarantees we never do worse than greedy.
  const a = improve(greedy(true));
  const b = improve(greedy(false));
  let best = better(keyOf(b.totals, b.fit), keyOf(a.totals, a.fit)) ? b : a;

  // Moves and swaps can stall on plateaus (for example 11/10/10/10/8 around a locked task).
  // Restart from seeded shuffles of the task order and keep the best, stopping at the ideal gap.
  const totalEffort = ts.reduce((sum, t) => sum + t.effort, 0);
  const idealGap = totalEffort % nM === 0 ? 0 : 1;
  const rand = mulberry32(ts.length * 7919 + nM * 104729 + totalEffort);
  for (let r = 0; r < RESTARTS && keyOf(best.totals, 0)[0] > idealGap; r++) {
    const shuffled = [...order];
    for (let k = shuffled.length - 1; k > 0; k--) {
      const j = Math.floor(rand() * (k + 1));
      [shuffled[k], shuffled[j]] = [shuffled[j]!, shuffled[k]!];
    }
    const c = improve(greedy(r % 2 === 0, shuffled));
    if (better(keyOf(c.totals, c.fit), keyOf(best.totals, best.fit))) best = c;
  }

  const assignments: Record<number, number> = {};
  ts.forEach((t, i) => (assignments[t.id] = ms[best.owner[i]!]!.id));
  const totals: Record<number, number> = {};
  ms.forEach((m, i) => (totals[m.id] = best.totals[i]!));
  return { assignments, totals, maxGap: keyOf(best.totals, 0)[0] };
}
