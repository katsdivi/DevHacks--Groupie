import { Composer, InlineKeyboard, InputFile, type Context } from 'grammy';
import {
  colorEmoji,
  formatMeeting,
  googleCalendarUrl,
  icsFile,
  modeLabel,
  parseMeetingLocation,
  tzLabel,
  type MeetingInfo,
  type MeetingSummary,
} from '@groupie/shared';
import { bot } from './core.ts';
import { html } from './format.ts';
import { clearPending, getGroup, setPending } from '../groups.ts';
import { listMembers } from '../members.ts';
import { latestMeeting, updateMeeting } from '../availability.ts';
import { createCalendarEvent, googleConfigured } from '../calendar.ts';
import { sendEmail } from '../gmail.ts';
import type { Meeting } from '../db/schema.ts';

export const meetingComposer = new Composer();

const LINK_TTL_MS = 10 * 60 * 1000;
const mention = (id: number, name: string) => `<a href="tg://user?id=${id}">${html(name)}</a>`;

/** Where to meet, in words: the link or place we have, or what we still need. */
function whereText(m: Meeting): string {
  if (m.mode === 'in_person') return m.location ? `In person at ${html(m.location)}` : 'In person (place to be decided)';
  return m.meetLink ? `${modeLabel(m.mode)}` : `${modeLabel(m.mode)} (link coming)`;
}

function meetingInfo(groupId: number, m: Meeting): MeetingInfo {
  const group = getGroup(groupId)!;
  const members = listMembers(groupId);
  const where = m.mode === 'in_person' ? m.location : m.meetLink;
  return {
    title: `${group.assignmentTitle ?? group.title}: team meeting`,
    start: m.start,
    end: m.end,
    location: where,
    details: [
      `Planned by ${group.nickname} (Groupie) for ${group.title}.`,
      `Who: ${members.map((x) => x.name).join(', ')}`,
      'Agenda: quick check-in, blockers, next steps.',
      ...(m.meetLink ? [`Join: ${m.meetLink}`] : []),
    ].join('\n'),
  };
}

function meetingKeyboard(groupId: number, m: Meeting) {
  const kb = new InlineKeyboard();
  if (m.meetLink) kb.url(`Join ${modeLabel(m.mode)}`, m.meetLink).row();
  kb.url('Add to Google Calendar', googleCalendarUrl(meetingInfo(groupId, m)));
  if (m.eventLink) kb.row().url('Open calendar event', m.eventLink);
  return kb;
}

function meetingText(groupId: number, m: Meeting, opener: string): string {
  const group = getGroup(groupId)!;
  const members = listMembers(groupId);
  return [
    opener,
    '',
    `<b>${html(formatMeeting(m.start, m.end, group.tz))}</b> (${tzLabel(group.tz, new Date(m.start))})`,
    `<b>Where:</b> ${whereText(m)}`,
    ...(m.meetLink ? [`<b>Link:</b> ${html(m.meetLink)}`] : []),
    `<b>Who:</b> ${members.map((x) => `${colorEmoji(x.color)} ${html(x.name)}`).join(', ')}`,
  ].join('\n');
}

/** Creates the calendar event (if Google is connected), posts the meeting card and .ics, and DMs everyone. */
export async function finalizeMeeting(groupId: number) {
  const group = getGroup(groupId);
  let meeting = latestMeeting(groupId);
  if (!group || !meeting) return;
  const members = listMembers(groupId);
  const notes: string[] = [];
  // Loading state: this message turns into the meeting card once the calendar work is done.
  const pending = await bot.api
    .sendMessage(groupId, `${html(group.nickname)} here. Setting up your meeting, one sec...`, { parse_mode: 'HTML' })
    .catch(() => null);
  await bot.api.sendChatAction(groupId, 'typing').catch(() => {});

  if (googleConfigured() && !meeting.calendarEventId) {
    const emails = members.map((x) => x.email).filter((e): e is string => Boolean(e));
    try {
      const info = meetingInfo(groupId, meeting);
      const ev = await createCalendarEvent({
        summary: info.title,
        description: info.details,
        start: meeting.start,
        end: meeting.end,
        tz: group.tz,
        attendees: emails,
        location: info.location,
        withMeet: meeting.mode === 'meet' && !meeting.meetLink,
        requestId: `groupie-${groupId}-${meeting.id}`,
      });
      updateMeeting(meeting.id, {
        calendarEventId: ev.id,
        eventLink: ev.htmlLink,
        ...(ev.meetLink && !meeting.meetLink ? { meetLink: ev.meetLink } : {}),
      });
      meeting = latestMeeting(groupId)!;
      // Google doesn't email the organizer their own invite, so don't count them.
      const invited = emails.filter((e) => e.toLowerCase() !== ev.organizer?.toLowerCase()).length;
      notes.push(
        invited
          ? `Calendar invite emailed to ${invited} of ${members.length}.`
          : 'On the calendar. Add your email in My details to get invites.',
      );
    } catch (err) {
      console.error('createCalendarEvent failed', err);
      notes.push("Google Calendar didn't cooperate. Add it with the buttons below.");
      // Still get it into inboxes: a plain email with the link and the .ics.
      if (emails.length) {
        const sent = await emailMeeting(groupId, meeting, emails).catch((e) => (console.error('emailMeeting failed', e), false));
        if (sent) notes.push(`Emailed the details to ${emails.length} of ${members.length}.`);
      }
    }
  }
  if (meeting.mode !== 'in_person' && !meeting.meetLink) {
    notes.push(`No link yet. Anyone can add one with /meetlink https://...`);
  } else if (meeting.mode === 'in_person' && !meeting.location) {
    notes.push('No place yet. Add one with /meetlink Hayden Library, room 2B');
  }

  const card = meetingText(groupId, meeting, '📅 <b>Team meeting is on!</b>') + (notes.length ? `\n\n${notes.join('\n')}` : '');
  const cardOpts = {
    parse_mode: 'HTML' as const,
    reply_markup: meetingKeyboard(groupId, meeting),
    link_preview_options: { is_disabled: true },
  };
  const edited =
    pending !== null &&
    (await bot.api.editMessageText(groupId, pending.message_id, card, cardOpts).then(
      () => true,
      () => false,
    ));
  if (!edited) await bot.api.sendMessage(groupId, card, cardOpts);
  const ics = icsFile({ ...meetingInfo(groupId, meeting), uid: `groupie-${groupId}-${meeting.id}@groupie` });
  await bot.api
    .sendDocument(groupId, new InputFile(Buffer.from(ics), 'team-meeting.ics'), {
      caption: 'Tap to add it to any calendar app.',
    })
    .catch((err) => console.error('sendDocument ics failed', err));

  // Private copies for everyone who has started the bot.
  const humans = members.filter((x) => x.tgUserId && !x.isSeed);
  let sent = 0;
  for (const x of humans) {
    try {
      await bot.api.sendMessage(
        x.tgUserId!,
        meetingText(groupId, meeting, `${html(group.nickname)} here with your meeting for <b>${html(group.title)}</b>.`),
        { parse_mode: 'HTML', reply_markup: meetingKeyboard(groupId, meeting), link_preview_options: { is_disabled: true } },
      );
      sent++;
    } catch {
      // They haven't started the bot yet; nothing to do.
    }
  }
  if (humans.length) {
    const missing = humans.length - sent;
    await bot.api.sendMessage(
      groupId,
      missing
        ? `DMed the details to ${sent} of ${humans.length}. The rest: tap Start at @${bot.botInfo?.username ?? 'CubbieGroupieBot'} so I can DM you.`
        : `Sent everyone the details in DMs too.`,
    );
  }
}

/** Asks whoever tapped for the link (or place). Google Meet with calendar keys needs nothing. */
export async function askForMeetingLink(ctx: Context, m: Meeting) {
  if (m.mode === 'meet' && googleConfigured()) return finalizeMeeting(ctx.chat!.id);
  const user = ctx.from!;
  setPending(ctx.chat!.id, user.id, 'meeting_link', LINK_TTL_MS);
  const ask =
    m.mode === 'in_person'
      ? 'where are we meeting? Reply with the place.'
      : m.mode === 'zoom'
        ? 'reply with the Zoom link.'
        : 'reply with the Google Meet link (meet.google.com/new makes one).';
  await ctx.reply(`${mention(user.id, user.first_name)}, ${ask}`, {
    parse_mode: 'HTML',
    reply_markup: new InlineKeyboard().text('Skip for now', 'cal:skip'),
  });
}

/** Handles the reply after askForMeetingLink. Returns false if it wasn't usable (we asked again). */
export async function applyMeetingLink(ctx: Context, raw: string): Promise<boolean> {
  const groupId = ctx.chat!.id;
  const m = latestMeeting(groupId);
  if (!m) return true;
  const value = parseMeetingLocation(raw, m.mode);
  if (!value) {
    await ctx.reply(
      m.mode === 'in_person' ? 'Keep the place under 120 characters?' : "I couldn't find a link in that. Paste the full https:// link?",
      { reply_parameters: { message_id: ctx.msg!.message_id } },
    );
    return false;
  }
  clearPending(groupId, ctx.from!.id);
  updateMeeting(m.id, m.mode === 'in_person' ? { location: value } : { meetLink: value });
  await finalizeMeeting(groupId);
  return true;
}

meetingComposer.callbackQuery('cal:skip', async (ctx) => {
  await ctx.answerCallbackQuery();
  clearPending(ctx.chat!.id, ctx.from.id);
  await ctx.editMessageReplyMarkup().catch(() => {});
  await finalizeMeeting(ctx.chat!.id);
});

meetingComposer.command('meetlink', async (ctx) => {
  const m = latestMeeting(ctx.chat.id);
  if (!m) return void (await ctx.reply('No meeting yet. Lock a time with /avail first.'));
  if (!ctx.match.trim()) {
    await ctx.reply(`Send it like this: /meetlink ${m.mode === 'in_person' ? 'Hayden Library, room 2B' : 'https://zoom.us/j/123456789'}`);
    return;
  }
  await applyMeetingLink(ctx, ctx.match);
});

/** What the Mini App shows on Home. */
export function meetingSummary(groupId: number, m: Meeting | undefined): MeetingSummary | null {
  if (!m) return null;
  const group = getGroup(groupId)!;
  return {
    start: m.start,
    end: m.end,
    label: formatMeeting(m.start, m.end, group.tz),
    mode: m.mode,
    join_url: m.meetLink,
    location: m.location,
    calendar_url: googleCalendarUrl(meetingInfo(groupId, m)),
    event_url: m.eventLink,
  };
}

/** Meeting email (used when the Calendar invite could not be created). */
async function emailMeeting(groupId: number, m: Meeting, to: string[]): Promise<boolean> {
  const group = getGroup(groupId)!;
  const info = meetingInfo(groupId, m);
  const when = `${formatMeeting(m.start, m.end, group.tz)} (${tzLabel(group.tz, new Date(m.start))})`;
  const where = m.mode === 'in_person' ? (m.location ?? 'Place to be decided') : (m.meetLink ?? `${modeLabel(m.mode)}, link coming`);
  const join = m.meetLink ? `<p><a href="${m.meetLink}" style="background:#A6E35A;color:#1E1E1E;padding:10px 18px;border-radius:999px;text-decoration:none;font-weight:600">Join ${html(modeLabel(m.mode))}</a></p>` : '';
  await sendEmail({
    to,
    subject: `📅 ${info.title}: ${formatMeeting(m.start, m.end, group.tz)}`,
    text: `${group.nickname} here from ${group.title}.\n\n${when}\nWhere: ${where}\n\nAdd to Google Calendar: ${googleCalendarUrl(info)}\n\nThe .ics file is attached for any calendar app.`,
    html: `<div style="font-family:Inter,Arial,sans-serif;max-width:520px"><p>${html(group.nickname)} here from <b>${html(group.title)}</b>.</p><h2 style="margin:8px 0">${html(when)}</h2><p>Where: ${html(where)}</p>${join}<p><a href="${googleCalendarUrl(info)}">Add to Google Calendar</a></p><p style="color:#888">The .ics file is attached for any calendar app.</p></div>`,
    attachments: [{ filename: 'team-meeting.ics', contentType: 'text/calendar; method=PUBLISH', content: icsFile({ ...info, uid: `groupie-${groupId}-${m.id}@groupie` }) }],
  });
  return true;
}
