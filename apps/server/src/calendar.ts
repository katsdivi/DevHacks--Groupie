import { auth, calendar } from '@googleapis/calendar';
import { env } from './env.ts';

export const CALENDAR_SCOPES = ['https://www.googleapis.com/auth/calendar.events'];

/** True once GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REFRESH_TOKEN are all set. */
export const googleConfigured = () => Boolean(env.googleClientId && env.googleClientSecret && env.googleRefreshToken);

export function oauthClient(redirectUri?: string) {
  return new auth.OAuth2(env.googleClientId, env.googleClientSecret, redirectUri);
}

export type EventInput = {
  summary: string;
  description: string;
  start: string; // UTC ISO
  end: string;
  tz: string;
  attendees: string[];
  location: string | null;
  /** Ask Google to attach a Meet link. */
  withMeet: boolean;
  requestId: string;
};

export type CreatedEvent = { id: string; htmlLink: string | null; meetLink: string | null };

/** The events.insert request: Meet link (when asked), attendees, invites emailed to everyone. */
export function buildEventRequest(input: EventInput) {
  return {
    calendarId: 'primary',
    conferenceDataVersion: input.withMeet ? 1 : 0,
    sendUpdates: 'all' as const,
    requestBody: {
      summary: input.summary,
      description: input.description,
      location: input.location ?? undefined,
      start: { dateTime: input.start, timeZone: input.tz },
      end: { dateTime: input.end, timeZone: input.tz },
      attendees: input.attendees.map((email) => ({ email })),
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 15 }] },
      ...(input.withMeet
        ? { conferenceData: { createRequest: { requestId: input.requestId, conferenceSolutionKey: { type: 'hangoutsMeet' } } } }
        : {}),
    },
  };
}

/** Creates the event on the authorized account and emails the invite to attendees. */
export async function createCalendarEvent(input: EventInput): Promise<CreatedEvent> {
  const client = oauthClient();
  client.setCredentials({ refresh_token: env.googleRefreshToken });
  const cal = calendar({ version: 'v3', auth: client });
  const res = await cal.events.insert(buildEventRequest(input));
  const ev = res.data;
  const meet = ev.hangoutLink ?? ev.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video')?.uri ?? null;
  return { id: ev.id ?? '', htmlLink: ev.htmlLink ?? null, meetLink: meet };
}
