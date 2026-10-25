import { useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { slotStart, SLOT_MINUTES, type Grid } from '@groupie/shared';
import { haptic } from '../telegram.ts';

const ROW_H = 24;
const ROW_H_WIDE = 30;
const LABEL_W = 38;
const SLOT_MS = SLOT_MINUTES * 60_000;
const LIME = '166, 227, 90';

export type Cell = { slot: string; d: number; r: number; past: boolean };
export type Heat = {
  /** slot id -> how many members are free. */
  count: (slot: string) => number;
  max: number;
  /** First slot of the best hour, if it's on the grid. */
  best: string | null;
  bestSpan: number;
  picked: string | null;
};

/** Every grid cell with its canonical slot id, indexed [day][row]. */
export function buildCells(grid: Grid, now: number): Cell[][] {
  return grid.days.map((day, d) =>
    grid.rows.map((row, r) => {
      const slot = slotStart(grid.tz, day.date, row.hour, row.minute);
      return { slot, d, r, past: Date.parse(slot) < now };
    }),
  );
}

type Props = {
  grid: Grid;
  cells: Cell[][];
  now: number;
  mode: 'mine' | 'group';
  selected: Set<string>;
  color: string;
  heat: Heat | null;
  onPaint: (slots: string[], add: boolean) => void;
  onPick: (slot: string) => void;
  /** Your own busy slots from your calendar (Mine view only, never titles). */
  busy?: Set<string>;
  /** Selected because the calendar prefill picked them, not touched since. */
  fromCal?: Set<string>;
};

/** Dotted "busy on your calendar" texture, distinct from the striped past cells. */
export const BUSY_BG = 'radial-gradient(circle, rgba(255,255,255,0.22) 0.9px, transparent 1.3px)';
export const BUSY_BG_SIZE = '5px 5px';
/** Prefilled selections are the member's color, slightly lighter. */
export const PREFILL_OPACITY = 0.6;

/** "4 PM" or "4:30 PM" for the top of a painted block. */
function shortTime(row: { hour: number; minute: number }) {
  const h = row.hour % 12 || 12;
  return `${row.minute ? `${h}:${String(row.minute).padStart(2, '0')}` : h} ${row.hour < 12 ? 'AM' : 'PM'}`;
}

export function AvailabilityGrid({ grid, cells, now, mode, selected, color, heat, onPaint, onPick, busy, fromCal }: Props) {
  const matrix = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; add: boolean; d: number; r: number; seen: Set<string> } | null>(null);
  const lastBuzz = useRef(0);
  const rows = grid.rows.length;
  // Roomier rows when there's a mouse and a big screen (browser link on desktop).
  const [rowH] = useState(() => (window.matchMedia('(min-width: 640px)').matches ? ROW_H_WIDE : ROW_H));

  const bestAt = useMemo(() => {
    if (!heat?.best) return null;
    for (const col of cells) for (const c of col) if (c.slot === heat.best) return c;
    return null;
  }, [cells, heat?.best]);

  const cellFrom = (el: Element | null): Cell | null => {
    const node = el?.closest<HTMLElement>('[data-slot]');
    if (!node) return null;
    return cells[Number(node.dataset.d)]?.[Number(node.dataset.r)] ?? null;
  };

  const buzz = (force = false) => {
    const t = performance.now();
    if (force || t - lastBuzz.current > 45) {
      lastBuzz.current = t;
      haptic.select();
    }
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (mode !== 'mine' || drag.current) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const c = cellFrom(e.target as Element) ?? cellFrom(document.elementFromPoint(e.clientX, e.clientY));
    if (!c || c.past) return;
    e.preventDefault();
    matrix.current?.setPointerCapture(e.pointerId);
    const add = !selected.has(c.slot);
    drag.current = { id: e.pointerId, add, d: c.d, r: c.r, seen: new Set([c.slot]) };
    onPaint([c.slot], add);
    buzz(true);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const s = drag.current;
    if (!s || e.pointerId !== s.id) return;
    const c = cellFrom(document.elementFromPoint(e.clientX, e.clientY));
    if (!c || (c.d === s.d && c.r === s.r)) return;
    // Fill the cells between the last one and this one, so a fast swipe leaves no gaps.
    const dd = c.d - s.d;
    const dr = c.r - s.r;
    const steps = Math.max(Math.abs(dd), Math.abs(dr));
    const path: string[] = [];
    for (let i = 1; i <= steps; i++) {
      const cell = cells[Math.round(s.d + (dd * i) / steps)]?.[Math.round(s.r + (dr * i) / steps)];
      if (cell && !cell.past && !s.seen.has(cell.slot)) {
        s.seen.add(cell.slot);
        path.push(cell.slot);
      }
    }
    s.d = c.d;
    s.r = c.r;
    if (path.length) {
      onPaint(path, s.add);
      buzz();
    }
  };

  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current || e.pointerId !== drag.current.id) return;
    drag.current = null;
    if (matrix.current?.hasPointerCapture(e.pointerId)) matrix.current.releasePointerCapture(e.pointerId);
  };

  const cols: CSSProperties = { gridTemplateColumns: `${LABEL_W}px repeat(${grid.days.length}, minmax(0, 1fr))` };
  const mine = mode === 'mine';

  return (
    <div className="relative">
      {/* Day headers stay pinned while the page scrolls. */}
      <div className="sticky top-0 z-30 grid bg-ink pt-1 pb-2" style={cols}>
        <div />
        {grid.days.map((day) => (
          <div key={day.date} className="flex flex-col items-center gap-1">
            <span
              className={`text-[11px] font-semibold uppercase tracking-wider ${day.isToday ? 'text-text' : 'text-muted'}`}
            >
              {day.weekday}
            </span>
            <span
              className={`flex h-7 min-w-7 items-center justify-center rounded-full px-1 text-[15px] font-semibold tabular-nums ${
                day.isToday ? 'bg-text text-ink' : 'text-text'
              }`}
            >
              {day.dayNum}
            </span>
          </div>
        ))}
      </div>

      <div className="grid pt-2" style={cols}>
        {/* Hour labels sit on the hour lines. This column scrolls the page on touch. */}
        <div className="relative" style={{ height: rows * rowH }} aria-hidden>
          {grid.rows.map((row, r) =>
            row.label ? (
              <span
                key={r}
                className="absolute right-2 -translate-y-1/2 text-[10px] font-medium whitespace-nowrap text-muted tabular-nums"
                style={{ top: r * rowH }}
              >
                {row.label}
              </span>
            ) : null,
          )}
        </div>

        <div
          ref={matrix}
          role="grid"
          aria-label={mine ? 'Your free times. Drag to paint.' : 'When the group is free'}
          className={`relative col-span-7 grid border-b border-line select-none ${mine ? 'cursor-pointer touch-none' : ''}`}
          style={{
            gridTemplateColumns: `repeat(${grid.days.length}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${rows}, ${rowH}px)`,
            WebkitTouchCallout: 'none',
            WebkitUserSelect: 'none',
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onLostPointerCapture={endDrag}
          onContextMenu={(e) => e.preventDefault()}
          onClick={(e) => {
            if (mine) return;
            const c = cellFrom(e.target as Element);
            if (c) onPick(c.slot);
          }}
        >
          {cells.map((col, d) =>
            col.map((c) => {
              const row = grid.rows[c.r];
              const onHour = row.minute === 0;
              const on = mine && selected.has(c.slot);
              const above = mine && c.r > 0 && selected.has(col[c.r - 1].slot);
              const below = mine && c.r < rows - 1 && selected.has(col[c.r + 1].slot);
              const runStart = on && !above && below;
              const n = heat ? heat.count(c.slot) : 0;
              const level = heat && n > 0 ? n / heat.max : 0;
              const picked = !mine && heat?.picked === c.slot;
              const isBusy = mine && !c.past && Boolean(busy?.has(c.slot));
              const cal = on && Boolean(fromCal?.has(c.slot));
              const nowInCell = grid.days[d].isToday && now >= Date.parse(c.slot) && now < Date.parse(c.slot) + SLOT_MS;
              return (
                <div
                  key={c.slot}
                  role="gridcell"
                  aria-selected={on}
                  aria-disabled={c.past || undefined}
                  data-slot={c.slot}
                  data-d={c.d}
                  data-r={c.r}
                  title={isBusy ? 'Busy on your calendar' : cal ? 'Filled from your calendar' : undefined}
                  className={`relative ${d > 0 ? 'border-l border-l-[#2C2C2C]' : ''} ${
                    onHour ? 'border-t border-t-line' : 'border-t border-t-[#333333]'
                  } ${c.past ? 'cursor-not-allowed' : mine ? 'hover:bg-white/[0.04]' : 'cursor-pointer'}`}
                  style={{
                    gridColumn: d + 1,
                    gridRow: c.r + 1,
                    borderTopStyle: onHour ? 'solid' : 'dashed',
                    backgroundImage: c.past
                      ? 'repeating-linear-gradient(135deg, rgba(255,255,255,0.035) 0 3px, transparent 3px 7px)'
                      : isBusy
                        ? BUSY_BG
                        : undefined,
                    backgroundSize: isBusy && !c.past ? BUSY_BG_SIZE : undefined,
                    backgroundColor: isBusy ? 'rgba(255,255,255,0.025)' : undefined,
                  }}
                >
                  {on && (
                    <span
                      className={`pointer-events-none absolute inset-x-[3px] z-10 flex items-start justify-start overflow-hidden ${
                        c.past ? 'opacity-40' : ''
                      }`}
                      style={{
                        top: above ? -1 : 2,
                        bottom: below ? 0 : 2,
                        background: color,
                        opacity: cal ? PREFILL_OPACITY : undefined,
                        borderTopLeftRadius: above ? 0 : 6,
                        borderTopRightRadius: above ? 0 : 6,
                        borderBottomLeftRadius: below ? 0 : 6,
                        borderBottomRightRadius: below ? 0 : 6,
                      }}
                    >
                      {runStart && (
                        <span className="truncate px-1 pt-[3px] text-[9px] leading-none font-bold whitespace-nowrap text-ink/75 tabular-nums">
                          {shortTime(row)}
                        </span>
                      )}
                      {isBusy && (
                        <span
                          className="absolute inset-0"
                          style={{ backgroundImage: BUSY_BG.replace('255,255,255,0.22', '30,30,30,0.35'), backgroundSize: BUSY_BG_SIZE }}
                        />
                      )}
                    </span>
                  )}
                  {!mine && n > 0 && (
                    <span
                      className={`pointer-events-none absolute inset-[2px] flex items-center justify-center rounded-[5px] text-[10px] font-bold tabular-nums transition-colors duration-300 ${
                        level > 0.55 ? 'text-ink/80' : 'text-text/70'
                      } ${c.past ? 'opacity-40' : ''}`}
                      style={{ background: `rgba(${LIME}, ${0.14 + 0.86 * level})` }}
                    >
                      {n}
                    </span>
                  )}
                  {picked && (
                    <span className="pointer-events-none absolute inset-[1px] z-20 rounded-[6px] ring-2 ring-text" />
                  )}
                  {nowInCell && (
                    <span
                      className="pointer-events-none absolute inset-x-0 z-20 flex items-center"
                      style={{ top: `${((now - Date.parse(c.slot)) / SLOT_MS) * 100}%` }}
                    >
                      <span className="-ml-[3px] h-1.5 w-1.5 rounded-full bg-[#FF6B5B]" />
                      <span className="h-px flex-1 bg-[#FF6B5B]" />
                    </span>
                  )}
                </div>
              );
            }),
          )}

          {!mine && bestAt && heat && (
            <div
              className="pointer-events-none relative z-20 rounded-[7px] shadow-[0_0_0_2px_#F5F5F5,0_0_22px_rgba(166,227,90,0.45)]"
              style={{ gridColumn: bestAt.d + 1, gridRow: `${bestAt.r + 1} / span ${heat.bestSpan}` }}
            >
              <span className="absolute -top-2 left-1/2 -translate-x-1/2 rounded-full bg-text px-1.5 py-[2px] text-[9px] leading-none font-bold tracking-wider text-ink uppercase">
                Best
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
