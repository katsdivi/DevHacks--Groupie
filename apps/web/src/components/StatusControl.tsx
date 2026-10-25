import type { TaskStatus } from '@groupie/shared';

export const STATUS_ORDER: TaskStatus[] = ['todo', 'on_track', 'stuck', 'done'];

export const STATUS: Record<TaskStatus, { label: string; color: string; fg: string }> = {
  todo: { label: 'To do', color: '#4A4A4A', fg: '#F5F5F5' },
  on_track: { label: 'On track', color: '#4FD8E8', fg: '#1E1E1E' },
  stuck: { label: 'Stuck', color: '#FF6B5B', fg: '#1E1E1E' },
  done: { label: 'Done', color: '#A6E35A', fg: '#1E1E1E' },
};

/** Four-way segmented pill with a sliding thumb in the status color. */
export function StatusControl({
  value,
  onChange,
  label,
}: {
  value: TaskStatus;
  onChange: (s: TaskStatus) => void;
  label: string;
}) {
  const index = STATUS_ORDER.indexOf(value);
  return (
    <div role="radiogroup" aria-label={label} className="relative grid grid-cols-4 rounded-full bg-ink p-1">
      <span
        aria-hidden
        className="absolute top-1 bottom-1 left-1 rounded-full transition-[transform,background-color] duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)]"
        style={{
          width: 'calc((100% - 8px) / 4)',
          transform: `translateX(${index * 100}%)`,
          background: STATUS[value].color,
        }}
      />
      {STATUS_ORDER.map((s) => {
        const on = s === value;
        return (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => !on && onChange(s)}
            className={`relative z-[1] rounded-full py-2 text-[13px] font-semibold whitespace-nowrap transition-colors duration-200 active:scale-95 ${
              on ? '' : 'text-muted'
            }`}
            style={on ? { color: STATUS[s].fg } : undefined}
          >
            {STATUS[s].label}
          </button>
        );
      })}
    </div>
  );
}
