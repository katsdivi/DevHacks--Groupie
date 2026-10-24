import { z } from 'zod';
import { SKILL_TAGS } from './assignment.ts';

export const GroupStatus = z.enum(['setup', 'collecting_members', 'split_ready', 'scheduling', 'active']);

export const GroupSummary = z.object({
  id: z.number(),
  title: z.string(),
  nickname: z.string(),
  status: GroupStatus,
  team_size: z.number().nullable(),
});
export type GroupSummary = z.infer<typeof GroupSummary>;

export const TgUser = z.object({
  id: z.number(),
  first_name: z.string(),
  last_name: z.string().optional(),
  username: z.string().optional(),
});
export type TgUser = z.infer<typeof TgUser>;

export const Member = z.object({
  id: z.number(),
  name: z.string(),
  color: z.string(),
  email: z.string().nullable(),
  skills: z.array(z.enum(SKILL_TAGS)),
  weak_areas: z.array(z.enum(SKILL_TAGS)),
  is_seed: z.boolean(),
});
export type Member = z.infer<typeof Member>;

export const MeResponse = z.object({
  user: TgUser,
  member: Member.nullable(),
  group: GroupSummary.extend({
    assignment_title: z.string().nullable(),
    joined: z.number(),
    task_count: z.number(),
    total_points: z.number(),
  }),
});
export type MeResponse = z.infer<typeof MeResponse>;

export const MemberRequest = z
  .object({
    name: z.string().trim().min(1, 'Add your name').max(40),
    email: z
      .string()
      .trim()
      .max(120)
      .optional()
      .transform((v) => v || undefined)
      .pipe(z.email('That email looks off').optional()),
    skills: z.array(z.enum(SKILL_TAGS)).max(8),
    weak_areas: z.array(z.enum(SKILL_TAGS)).max(8),
  })
  .refine((m) => !m.skills.some((s) => m.weak_areas.includes(s)), {
    message: 'A skill cannot also be a weak area',
    path: ['weak_areas'],
  });
export type MemberRequest = z.input<typeof MemberRequest>;

export const MemberResponse = z.object({ member: Member, joined: z.number(), team_size: z.number() });
export type MemberResponse = z.infer<typeof MemberResponse>;

export const NicknameRequest = z.object({ nickname: z.string() });
export type NicknameRequest = z.infer<typeof NicknameRequest>;

export const NicknameResponse = z.object({ nickname: z.string() });
export type NicknameResponse = z.infer<typeof NicknameResponse>;

export const ApiError = z.object({ error: z.string(), message: z.string() });
export type ApiError = z.infer<typeof ApiError>;

export const TaskStatus = z.enum(['todo', 'on_track', 'stuck', 'done']);
export type TaskStatus = z.infer<typeof TaskStatus>;

export const SplitTaskView = z.object({
  id: z.number(),
  title: z.string(),
  description: z.string(),
  effort: z.number(),
  skill_tags: z.array(z.string()),
  status: TaskStatus,
});
export type SplitTaskView = z.infer<typeof SplitTaskView>;

export const SplitMemberView = z.object({
  id: z.number(),
  name: z.string(),
  color: z.string(),
  points: z.number(),
  is_me: z.boolean(),
  tasks: z.array(SplitTaskView),
});
export type SplitMemberView = z.infer<typeof SplitMemberView>;

export const SplitResponse = z.object({
  group_id: z.number(),
  assignment_title: z.string().nullable(),
  due_date: z.string().nullable(),
  total_points: z.number(),
  max_gap: z.number(),
  members: z.array(SplitMemberView),
  /** Tasks with no assignee yet (before the split runs). */
  unassigned: z.array(SplitTaskView),
});
export type SplitResponse = z.infer<typeof SplitResponse>;

export const SwapRequest = z.object({
  task_id: z.number().int(),
  to_member_id: z.number().int().nullable().optional(),
});
export type SwapRequest = z.infer<typeof SwapRequest>;

export const SwapResponse = SplitResponse.extend({
  moved: z.object({ task_id: z.number(), from_member_id: z.number(), to_member_id: z.number() }).nullable(),
});
export type SwapResponse = z.infer<typeof SwapResponse>;

export const AvailabilityMeResponse = z.object({
  group: z.object({ id: z.number(), title: z.string(), nickname: z.string(), tz: z.string() }),
  member: z.object({ id: z.number(), name: z.string(), color: z.string() }),
  /** UTC ISO slot starts (30 minutes each). */
  slots: z.array(z.string()),
});
export type AvailabilityMeResponse = z.infer<typeof AvailabilityMeResponse>;

export const AvailabilityPutRequest = z.object({ slots: z.array(z.string()).max(7 * 48) });
export type AvailabilityPutRequest = z.infer<typeof AvailabilityPutRequest>;

export const AvailabilityPutResponse = z.object({ saved: z.number(), responded: z.number(), team_size: z.number() });
export type AvailabilityPutResponse = z.infer<typeof AvailabilityPutResponse>;

export const HeatmapMember = z.object({ id: z.number(), name: z.string(), color: z.string(), responded: z.boolean() });

export const HeatmapBest = z.object({
  start: z.string(),
  end: z.string(),
  /** Members free for the whole hour. */
  member_ids: z.array(z.number()),
  label: z.string(),
});
export type HeatmapBest = z.infer<typeof HeatmapBest>;

export const HeatmapResponse = z.object({
  tz: z.string(),
  team_size: z.number(),
  responded: z.number(),
  members: z.array(HeatmapMember),
  /** slot start -> member ids free then (only slots with at least one person). */
  slots: z.record(z.string(), z.array(z.number())),
  /** Best one-hour windows, best first (up to 5). */
  best: z.array(HeatmapBest),
});
export type HeatmapResponse = z.infer<typeof HeatmapResponse>;
