import { z } from 'zod';

export const SKILL_TAGS = ['writing', 'research', 'coding', 'design', 'data', 'presenting', 'editing', 'math'] as const;
export type SkillTag = (typeof SKILL_TAGS)[number];

export const EFFORTS = [1, 2, 3, 5, 8] as const;
export type Effort = (typeof EFFORTS)[number];

export const ParsedTask = z.object({
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().max(240),
  effort: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(5), z.literal(8)]),
  skill_tags: z.array(z.enum(SKILL_TAGS)).max(3),
});
export type ParsedTask = z.infer<typeof ParsedTask>;

export const ParsedAssignment = z.object({
  assignment_title: z.string().trim().min(1).max(120),
  due_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}/)
    .nullable(),
  tasks: z.array(ParsedTask).min(3).max(16),
});
export type ParsedAssignment = z.infer<typeof ParsedAssignment>;

/** Strict JSON schema for LLM structured output. Mirrors ParsedAssignment. */
export const parsedAssignmentJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['assignment_title', 'due_date', 'tasks'],
  properties: {
    assignment_title: { type: 'string' },
    due_date: { type: ['string', 'null'], description: 'YYYY-MM-DD, or null if no due date is stated' },
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'description', 'effort', 'skill_tags'],
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          // Vocabularies are guidance here and enforced in code (sanitizeAssignment), so one stray
          // tag doesn't make the provider reject the whole response.
          effort: { type: 'integer', description: `One of ${EFFORTS.join(', ')}` },
          skill_tags: { type: 'array', items: { type: 'string', description: `One of ${SKILL_TAGS.join(', ')}` } },
        },
      },
    },
  },
} as const;

/** Snaps any number to the nearest allowed effort. */
export function snapEffort(n: unknown): Effort {
  const v = Number(n);
  if (!Number.isFinite(v)) return 2;
  return EFFORTS.reduce((best, e) => (Math.abs(e - v) < Math.abs(best - v) ? e : best), EFFORTS[0]);
}

/** Coerces raw LLM output toward ParsedAssignment: known tags only (max 3), snapped efforts. */
export function sanitizeAssignment(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const r = raw as { tasks?: unknown };
  if (!Array.isArray(r.tasks)) return raw;
  return {
    ...r,
    tasks: r.tasks.map((t) => {
      if (!t || typeof t !== 'object') return t;
      const task = t as { effort?: unknown; skill_tags?: unknown };
      const tags = Array.isArray(task.skill_tags)
        ? task.skill_tags.map((x) => String(x).toLowerCase().trim()).filter((x): x is SkillTag => (SKILL_TAGS as readonly string[]).includes(x))
        : [];
      return { ...task, effort: snapEffort(task.effort), skill_tags: [...new Set(tags)].slice(0, 3) };
    }),
  };
}
