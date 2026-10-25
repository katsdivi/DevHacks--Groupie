import { MEMBER_COLORS } from '@groupie/shared';

/** Same course, same color, on every screen: a tiny string hash into the member palette. */
export function courseColor(course: string | null): string {
  if (!course) return '#9A9A9A';
  let h = 0;
  for (let i = 0; i < course.length; i++) h = (h * 31 + course.charCodeAt(i)) >>> 0;
  return MEMBER_COLORS[h % MEMBER_COLORS.length].hex;
}

/** "CSE 340 (Fall 2026)" reads as "CSE 340" on a chip. */
export function courseLabel(course: string | null): string {
  if (!course) return 'Canvas';
  return course.replace(/\s*\([^)]*\)\s*$/, '').trim() || course;
}

export function CourseChip({ course, size = 'sm' }: { course: string | null; size?: 'sm' | 'md' }) {
  const color = courseColor(course);
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1.5 truncate rounded-full border font-semibold ${
        size === 'md' ? 'px-3 py-1.5 text-[13px]' : 'px-2.5 py-0.5 text-[12px]'
      }`}
      style={{ color, borderColor: `${color}55`, background: `${color}14` }}
      title={course ?? undefined}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
      <span className="truncate">{courseLabel(course)}</span>
    </span>
  );
}

/** "just now", "12 min ago", "3 h ago", "2 days ago". */
export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} ${d === 1 ? 'day' : 'days'} ago`;
}
