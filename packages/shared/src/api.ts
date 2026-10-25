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
  /** Opted in to the load-aware split. The group only ever sees "Busy week", never counts or courses. */
  share_workload: z.boolean(),
});
export type Member = z.infer<typeof Member>;

export const MeetingSummary = z.object({
  start: z.string(),
  end: z.string(),
  label: z.string(),
  mode: z.string().nullable(),
  join_url: z.string().nullable(),
  location: z.string().nullable(),
  calendar_url: z.string(),
  event_url: z.string().nullable(),
});
export type MeetingSummary = z.infer<typeof MeetingSummary>;

export const MeResponse = z.object({
  user: TgUser,
  member: Member.nullable(),
  group: GroupSummary.extend({
    meeting: MeetingSummary.nullable(),
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

export const WorkloadRequest = z.object({ shareWorkload: z.boolean() });
export type WorkloadRequest = z.infer<typeof WorkloadRequest>;

export const WorkloadResponse = z.object({ member: Member });
export type WorkloadResponse = z.infer<typeof WorkloadResponse>;

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

export const ProgressTask = z.object({
  id: z.number(),
  title: z.string(),
  effort: z.number(),
  status: TaskStatus,
});
export type ProgressTask = z.infer<typeof ProgressTask>;

export const ProgressMember = z.object({
  id: z.number(),
  name: z.string(),
  color: z.string(),
  is_me: z.boolean(),
  points: z.number(),
  done_points: z.number(),
  /** 0 to 100, share of this member's points that are done. */
  percent: z.number(),
  tasks: z.array(ProgressTask),
});
export type ProgressMember = z.infer<typeof ProgressMember>;

export const ProgressResponse = z.object({
  group_id: z.number(),
  assignment_title: z.string().nullable(),
  due_date: z.string().nullable(),
  /** Whole days from today (group tz) to the due date; negative if overdue. */
  days_left: z.number().nullable(),
  total_points: z.number(),
  done_points: z.number(),
  percent: z.number(),
  members: z.array(ProgressMember),
});
export type ProgressResponse = z.infer<typeof ProgressResponse>;

export const TaskStatusRequest = z.object({ status: TaskStatus });
export type TaskStatusRequest = z.infer<typeof TaskStatusRequest>;

export const TaskStatusResponse = z.object({ task: ProgressTask, progress: ProgressResponse });
export type TaskStatusResponse = z.infer<typeof TaskStatusResponse>;

export const ChatMessage = z.object({
  id: z.number(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  created_at: z.string(),
});
export type ChatMessage = z.infer<typeof ChatMessage>;

export const ChatHistoryResponse = z.object({ messages: z.array(ChatMessage), suggestions: z.array(z.string()) });
export type ChatHistoryResponse = z.infer<typeof ChatHistoryResponse>;

export const ChatRequest = z.object({ group_id: z.number(), message: z.string().trim().min(1).max(1000) });
export type ChatRequest = z.infer<typeof ChatRequest>;

export const ChatResponse = z.object({ user: ChatMessage, reply: ChatMessage });
export type ChatResponse = z.infer<typeof ChatResponse>;
