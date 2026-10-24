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
