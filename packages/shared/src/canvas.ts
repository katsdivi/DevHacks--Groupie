import { z } from 'zod';

/**
 * Canvas via Cubbie: contract shared by the server, the Mini App, and the Cubbie Skill harness.
 * See docs/CANVAS_RECON.md for what Cubbie can and cannot do.
 */

// Pair codes: 6 characters, no lookalikes (0/O, 1/I/L), single use, 15 minute lifetime.
export const PAIR_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const PAIR_CODE_LENGTH = 6;
export const PAIR_CODE_TTL_MS = 15 * 60 * 1000;
export const PairCodeString = z
  .string()
  .trim()
  .toUpperCase()
  .regex(new RegExp(`^[${PAIR_CODE_ALPHABET}]{${PAIR_CODE_LENGTH}}$`), 'Pair codes are 6 letters and digits');

/** The exact text a student sends Cubbie. The Skill's trigger phrase is "Groupie import <CODE>". */
export const cubbieMessage = (code: string, assignmentHint?: string) =>
  `Groupie import ${code}${assignmentHint ? ` ${assignmentHint}` : ''}`;

// Security rules, enforced by the server.
/** Header carrying `sha256=<hex HMAC-SHA256(CUBBIE_PUBLIC_SIGNING_KEY, raw request body)>`. */
export const CUBBIE_SIGNATURE_HEADER = 'x-groupie-signature';
/** Only Canvas calendar feeds from ASU are accepted. */
export const ALLOWED_FEED_HOST = 'canvas.asu.edu';
/** Imports per pair code owner (Telegram user) per hour, and per IP per hour. */
export const IMPORT_RATE_LIMIT = { perUserPerHour: 10, perIpPerHour: 30 } as const;
/** Max decoded attachment size and count accepted on import. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS = 5;
export const FEED_POLL_INTERVAL_MS = 30 * 60 * 1000;

/** True for https://canvas.asu.edu/feeds/... style URLs. Everything else is rejected. */
export function isAllowedFeedUrl(raw: string): boolean {
  try {
    const u = new URL(raw.trim().replace(/^webcal:\/\//i, 'https://'));
    return u.protocol === 'https:' && u.hostname === ALLOWED_FEED_HOST && u.pathname.startsWith('/feeds/');
  } catch {
    return false;
  }
}

/** Normalizes a pasted feed URL (webcal:// to https://, trimmed) or returns null if not allowed. */
export function normalizeFeedUrl(raw: string): string | null {
  const url = raw.trim().replace(/^webcal:\/\//i, 'https://');
  return isAllowedFeedUrl(url) ? url : null;
}

// Cubbie import payload (what the Skill script POSTs).
export const RubricCriterion = z.object({
  name: z.string().trim().min(1).max(200),
  points: z.number().min(0).max(1000),
  ratings: z.array(z.string().trim().max(300)).max(10).default([]),
});
export type RubricCriterion = z.infer<typeof RubricCriterion>;

/** Max extracted text kept per attachment (characters). Longer ones are dropped by the server, not rejected. */
export const MAX_ATTACHMENT_TEXT = 60_000;

/** A URL field that never fails the payload: a bad or missing value becomes undefined. */
const looseUrl = z.string().url().max(2000).optional().catch(undefined);

/**
 * One attachment. Loose on purpose: unknown fields pass through, and an attachment with neither text nor
 * base64 (nor url) is ignored by the server with a log line instead of failing the whole import. Size caps
 * (MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_TEXT) are enforced by the server, which drops the file and goes on.
 */
export const CubbieAttachment = z
  .object({
    filename: z.string().trim().min(1).max(200).catch('attachment'),
    mimeType: z.string().trim().max(120).nullish().transform((m) => m || 'application/octet-stream'),
    /** Extracted text. What the Skill sends today (Cubbie reads the file and sends its text). */
    text: z.string().optional(),
    /** Raw file, base64. Accepted; posted to the group as a document and read through the normal file intake. */
    base64: z.string().optional(),
    /** A link for people (Canvas file links need a login, so the server never downloads these). */
    url: looseUrl,
  })
  .loose();
export type CubbieAttachment = z.infer<typeof CubbieAttachment>;

/**
 * What the Skill POSTs. Extra fields anywhere are tolerated. `assignment.descriptionText` is the
 * description (the older `description` key is still read). `attachments` and `rubric` are optional.
 */
export const CubbieImportPayload = z
  .object({
    pairCode: PairCodeString,
    course: z.object({ name: z.string().trim().min(1).max(200), code: z.string().trim().max(60).nullish() }).loose(),
    assignment: z
      .object({
        title: z.string().trim().min(1).max(300),
        /** ISO 8601 with offset, or null (or missing) when Canvas has no due date. */
        dueAt: z
          .string()
          .datetime({ offset: true })
          .nullish()
          .transform((d) => d ?? null),
        pointsPossible: z.number().min(0).max(100000).nullable().optional().catch(null),
        descriptionText: z.string().max(60_000).nullish(),
        /** Older name for descriptionText. */
        description: z.string().max(60_000).nullish(),
        url: looseUrl,
      })
      .loose()
      .transform(({ description, descriptionText, ...a }) => ({ ...a, descriptionText: descriptionText || description || '' })),
    rubric: z.object({ criteria: z.array(RubricCriterion).min(1).max(40) }).loose().optional(),
    attachments: z.array(CubbieAttachment).max(50).optional(),
  })
  .loose();
export type CubbieImportPayload = z.infer<typeof CubbieImportPayload>;

export const CubbieImportResponse = z.object({
  ok: z.literal(true),
  importId: z.number(),
  /** What the Skill tells the student. */
  message: z.string(),
});
export type CubbieImportResponse = z.infer<typeof CubbieImportResponse>;

// Pair codes (Mini App).
export const PairCodeRequest = z.object({ groupChatId: z.number().int().nullable().optional() });
export type PairCodeRequest = z.infer<typeof PairCodeRequest>;

export const PairCodeResponse = z.object({
  code: z.string(),
  expiresAt: z.string(),
  cubbieMessage: z.string(),
});
export type PairCodeResponse = z.infer<typeof PairCodeResponse>;

export const ImportStatus = z.enum(['waiting', 'received', 'imported', 'failed', 'expired']);
export type ImportStatus = z.infer<typeof ImportStatus>;

/** GET /api/cubbie/pair-code/:code: live status for the Mini App. */
export const PairCodeStatusResponse = z.object({
  code: z.string(),
  status: ImportStatus,
  expiresAt: z.string(),
  assignmentTitle: z.string().nullable(),
  error: z.string().nullable(),
});
export type PairCodeStatusResponse = z.infer<typeof PairCodeStatusResponse>;

// Calendar feed.
export const FeedEventKind = z.enum(['assignment', 'event']);
export const FeedEvent = z.object({
  uid: z.string(),
  course: z.string().nullable(),
  title: z.string(),
  dueAt: z.string(), // UTC ISO
  description: z.string().nullable(),
  url: z.string().nullable(),
  kind: FeedEventKind,
});
export type FeedEvent = z.infer<typeof FeedEvent>;

export const FeedPutRequest = z.object({ feedUrl: z.string().trim().min(1).max(2000) });
export type FeedPutRequest = z.infer<typeof FeedPutRequest>;

/** GET /api/feed/status. Never contains the feed URL. */
export const FeedStatusResponse = z.object({
  connected: z.boolean(),
  lastPolledAt: z.string().nullable(),
  lastError: z.string().nullable(),
  eventCount: z.number(),
  courses: z.array(z.string()),
});
export type FeedStatusResponse = z.infer<typeof FeedStatusResponse>;

/** GET /api/feed/upcoming: the caller's own items, soonest first. */
export const FeedUpcomingResponse = z.object({ events: z.array(FeedEvent) });
export type FeedUpcomingResponse = z.infer<typeof FeedUpcomingResponse>;
