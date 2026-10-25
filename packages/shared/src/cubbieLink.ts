import { z } from 'zod';
import { PairCodeString } from './canvas.ts';

/**
 * iMessage link: the student's Cubbie holds a Groupie token (made for them, saved in their own Cubbie sandbox)
 * and uses it to read their own Groupie status. Only the token's sha256 is stored on the server.
 */

/** The exact text a student sends Cubbie to link. The Skill's trigger phrase is "Groupie link <CODE>". */
export const cubbieLinkMessage = (code: string) => `Groupie link ${code}`;

/** Per IP for POST /api/cubbie/link; per token and per IP for GET /api/cubbie/me and DELETE /api/cubbie/link. */
export const CUBBIE_LINK_RATE_LIMITS = {
  linkPerIp: { limit: 20, windowMs: 10 * 60 * 1000 },
  mePerToken: { limit: 30, windowMs: 10 * 60 * 1000 },
  mePerIp: { limit: 120, windowMs: 10 * 60 * 1000 },
} as const;

/** How far ahead GET /api/cubbie/me looks for calendar items. */
export const CUBBIE_ME_DAYS = 7;

/** POST /api/cubbie/link (signed like the import). */
export const CubbieLinkRequest = z.object({ pairCode: PairCodeString });
export type CubbieLinkRequest = z.infer<typeof CubbieLinkRequest>;

export const CubbieLinkResponse = z.object({
  ok: z.literal(true),
  /** Shown once. The server keeps only its sha256. */
  token: z.string(),
  name: z.string().nullable(),
  message: z.string(),
});
export type CubbieLinkResponse = z.infer<typeof CubbieLinkResponse>;

export const CubbieMeTask = z.object({ title: z.string(), status: z.string(), points: z.number() });

export const CubbieMeMeeting = z.object({
  start: z.string(),
  label: z.string(),
  mode: z.string().nullable(),
  joinUrl: z.string().nullable(),
  location: z.string().nullable(),
});

export const CubbieMeGroup = z.object({
  title: z.string(),
  assignmentTitle: z.string().nullable(),
  dueDate: z.string().nullable(),
  dueLabel: z.string().nullable(),
  daysLeft: z.number().nullable(),
  myTasks: z.array(CubbieMeTask),
  myTasksLeft: z.number(),
  groupTasksDone: z.number(),
  groupTasksTotal: z.number(),
  nextMeeting: CubbieMeMeeting.nullable(),
});

export const CubbieMeItem = z.object({
  title: z.string(),
  course: z.string().nullable(),
  dueAt: z.string(),
  dueLabel: z.string(),
  kind: z.string(),
});

/** GET /api/cubbie/me: only the token owner's own data, plus group facts every member already sees. */
export const CubbieMeResponse = z.object({
  name: z.string().nullable(),
  now: z.string(),
  groups: z.array(CubbieMeGroup),
  upcoming: z.array(CubbieMeItem),
  counts: z.object({ myTasksLeft: z.number(), upcoming: z.number(), groups: z.number() }),
  summary: z.string(),
});
export type CubbieMeResponse = z.infer<typeof CubbieMeResponse>;
