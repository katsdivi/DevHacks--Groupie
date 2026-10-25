import { z } from 'zod';

/** Step 18a contract: personal memory, reminder prefs, calendar connections, prefilled availability. */

// Memory (Mini App: list, edit visibility, delete; private chat: save).
export const MemoryVisibility = z.enum(['private', 'group']);
export const MemoryItem = z.object({
  id: z.number(),
  key: z.string(),
  value: z.string(),
  source: z.enum(['chat', 'mini_app']),
  visibility: MemoryVisibility,
  /** The one group that can see it when visibility is 'group'. */
  group_chat_id: z.number().nullable(),
  updated_at: z.string(),
});
export type MemoryItem = z.infer<typeof MemoryItem>;
export const MemoryListResponse = z.object({ items: z.array(MemoryItem) });
export type MemoryListResponse = z.infer<typeof MemoryListResponse>;
export const MemoryCreateRequest = z.object({
  key: z.string().trim().min(1).max(60),
  value: z.string().trim().min(1).max(300),
  visibility: MemoryVisibility.default('private'),
  group_chat_id: z.number().int().nullable().optional(),
});
export type MemoryCreateRequest = z.input<typeof MemoryCreateRequest>;
export const MemoryUpdateRequest = z.object({
  value: z.string().trim().min(1).max(300).optional(),
  visibility: MemoryVisibility.optional(),
  group_chat_id: z.number().int().nullable().optional(),
});
export type MemoryUpdateRequest = z.input<typeof MemoryUpdateRequest>;

// Reminder prefs.
export const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');
export const PrefsResponse = z.object({
  reminders_enabled: z.boolean(),
  reminder_offsets: z.array(z.number().int().min(1).max(336)),
  quiet_start: HHMM,
  quiet_end: HHMM,
  tz: z.string(),
  can_dm: z.boolean(),
  /** t.me link that opens the bot DM with /start reminders, so Telegram lets us DM them. */
  start_link: z.string(),
});
export type PrefsResponse = z.infer<typeof PrefsResponse>;
export const PrefsUpdateRequest = z.object({
  reminders_enabled: z.boolean().optional(),
  reminder_offsets: z.array(z.number().int().min(1).max(336)).min(1).max(5).optional(),
  quiet_start: HHMM.optional(),
  quiet_end: HHMM.optional(),
  tz: z.string().max(64).optional(),
});
export type PrefsUpdateRequest = z.input<typeof PrefsUpdateRequest>;

// Calendar connections (busy blocks only, never titles).
export const CalendarKind = z.enum(['google', 'ics']);
export const CalendarConnectionStatus = z.object({
  kind: CalendarKind,
  connected: z.boolean(),
  last_sync_at: z.string().nullable(),
  last_error: z.string().nullable(),
});
export const CalendarStatusResponse = z.object({
  google_available: z.boolean(),
  connections: z.array(CalendarConnectionStatus),
  busy_block_count: z.number(),
});
export type CalendarStatusResponse = z.infer<typeof CalendarStatusResponse>;
export const CalendarIcsRequest = z.object({ url: z.string().trim().min(1).max(2000) });
export type CalendarIcsRequest = z.infer<typeof CalendarIcsRequest>;
export const GoogleStartResponse = z.object({ url: z.string() });
export type GoogleStartResponse = z.infer<typeof GoogleStartResponse>;

// Prefilled availability.
export const AvailabilityPrefill = z.object({
  /** True when a calendar is connected and the grid was prefilled from busy blocks. */
  prefilled: z.boolean(),
  /** UTC ISO slot starts covered by a busy block (shown as unavailable, never with titles). */
  busy_slots: z.array(z.string()),
  /** Local hours treated as reasonable when prefilling, e.g. 8 to 22. */
  hours: z.object({ start: z.number().int().min(0).max(23), end: z.number().int().min(1).max(24) }),
});
export type AvailabilityPrefill = z.infer<typeof AvailabilityPrefill>;
