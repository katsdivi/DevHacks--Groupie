import { SKILL_TAGS, type SkillTag } from '@groupie/shared';
import { haptic } from '../telegram.ts';

export const SKILL_LABELS: Record<SkillTag, string> = {
  writing: 'Writing',
  research: 'Research',
  coding: 'Coding',
  design: 'Design',
  data: 'Data',
  presenting: 'Presenting',
  editing: 'Editing',
  math: 'Math',
};

type Props = {
  selected: SkillTag[];
  onToggle: (tag: SkillTag) => void;
  accent: string;
  /** Tags picked in the other list, shown dimmed. */
  elsewhere?: SkillTag[];
};

export function Chips({ selected, onToggle, accent, elsewhere = [] }: Props) {
  return (
    <div className="flex flex-wrap gap-2">
      {SKILL_TAGS.map((tag) => {
        const on = selected.includes(tag);
        const dim = !on && elsewhere.includes(tag);
        return (
          <button
            key={tag}
            type="button"
            aria-pressed={on}
            onClick={() => {
              haptic.select();
              onToggle(tag);
            }}
            className={`rounded-full border px-4 py-2.5 text-[15px] font-medium transition-all duration-150 active:scale-95 ${
              on ? 'border-transparent text-ink' : 'border-dashed border-line-strong text-text'
            } ${dim ? 'opacity-35' : ''}`}
            style={on ? { background: accent } : undefined}
          >
            {SKILL_LABELS[tag]}
          </button>
        );
      })}
    </div>
  );
}
