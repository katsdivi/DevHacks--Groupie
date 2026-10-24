import { z } from 'zod';

export const HealthResponse = z.object({
  ok: z.literal(true),
  service: z.literal('groupie'),
  time: z.string(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

// Member accents, assigned in join order. All read well on #1E1E1E.
export const MEMBER_COLORS = [
  { name: 'coral', hex: '#FF6B5B' },
  { name: 'amber', hex: '#FFB547' },
  { name: 'lime', hex: '#A6E35A' },
  { name: 'cyan', hex: '#4FD8E8' },
  { name: 'violet', hex: '#A88BFF' },
  { name: 'pink', hex: '#FF7AC6' },
] as const;

export * from './nickname.ts';
export * from './startParam.ts';
export * from './api.ts';
