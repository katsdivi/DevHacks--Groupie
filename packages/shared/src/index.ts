import { z } from 'zod';

export const HealthResponse = z.object({
  ok: z.literal(true),
  service: z.literal('groupie'),
  time: z.string(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

// Member accents, assigned in join order. All read well on #1E1E1E.
// `emoji` is the closest colored dot for plain Telegram messages (there is no pink circle).
export const MEMBER_COLORS = [
  { name: 'coral', hex: '#FF6B5B', emoji: '🔴' },
  { name: 'amber', hex: '#FFB547', emoji: '🟠' },
  { name: 'lime', hex: '#A6E35A', emoji: '🟢' },
  { name: 'cyan', hex: '#4FD8E8', emoji: '🔵' },
  { name: 'violet', hex: '#A88BFF', emoji: '🟣' },
  { name: 'pink', hex: '#FF7AC6', emoji: '🩷' },
] as const;

export const colorEmoji = (hex: string) => MEMBER_COLORS.find((c) => c.hex === hex)?.emoji ?? '⚪';
export const colorName = (hex: string) => MEMBER_COLORS.find((c) => c.hex === hex)?.name ?? 'mystery';

export * from './nickname.ts';
export * from './startParam.ts';
export * from './api.ts';
export * from './assignment.ts';
export * from './split.ts';
export * from './swap.ts';
export * from './time.ts';
export * from './linkToken.ts';
export * from './meeting.ts';
