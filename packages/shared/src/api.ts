import { z } from 'zod';

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
});
export type Member = z.infer<typeof Member>;

export const MeResponse = z.object({
  user: TgUser,
  member: Member.nullable(),
  group: GroupSummary,
});
export type MeResponse = z.infer<typeof MeResponse>;

export const NicknameRequest = z.object({ nickname: z.string() });
export type NicknameRequest = z.infer<typeof NicknameRequest>;

export const NicknameResponse = z.object({ nickname: z.string() });
export type NicknameResponse = z.infer<typeof NicknameResponse>;

export const ApiError = z.object({ error: z.string(), message: z.string() });
export type ApiError = z.infer<typeof ApiError>;
