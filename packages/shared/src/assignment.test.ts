import { describe, expect, it } from 'vitest';
import { ParsedAssignment, sanitizeAssignment, snapEffort } from './assignment.ts';

describe('snapEffort', () => {
  it('snaps to the nearest allowed value', () => {
    expect([0, 1, 2, 4, 6, 7, 13, 'x'].map(snapEffort)).toEqual([1, 1, 2, 3, 5, 8, 8, 2]);
  });
});

describe('sanitizeAssignment', () => {
  it('drops unknown tags, dedupes, caps at 3, and validates', () => {
    const raw = {
      assignment_title: 'X',
      due_date: null,
      tasks: [1, 2, 3].map((i) => ({ title: `T${i}`, description: '', effort: 4, skill_tags: ['Coding', 'testing', 'coding', 'data', 'math', 'design'] })),
    };
    const out = ParsedAssignment.parse(sanitizeAssignment(raw));
    expect(out.tasks[0]).toMatchObject({ effort: 3, skill_tags: ['coding', 'data', 'math'] });
  });
});
