import { modeLabel, type MeetingSummary } from '@groupie/shared';
import { haptic, openExternal } from '../telegram.ts';

/** "Next meeting" on Home: when, where, and one-tap join / add to calendar. */
export function MeetingCard({ meeting }: { meeting: MeetingSummary }) {
  const where =
    meeting.mode === 'in_person'
      ? meeting.location
        ? `In person at ${meeting.location}`
        : 'In person, place to be decided'
      : meeting.mode
        ? `${modeLabel(meeting.mode)}${meeting.join_url ? '' : ', link coming'}`
        : 'Picking how to meet';
  const past = new Date(meeting.end) < new Date();
  return (
    <section className="mt-4 rounded-3xl border border-dashed border-[#A6E35A]/50 bg-[#A6E35A]/[0.06] p-5">
      <div className="text-[13px] font-medium uppercase tracking-widest text-[#A6E35A]">
        {past ? 'Last meeting' : 'Next meeting'}
      </div>
      <div className="mt-2 text-[20px] font-semibold leading-snug">{meeting.label}</div>
      <div className="mt-1 text-[15px] text-muted">{where}</div>
      <div className="mt-4 flex flex-wrap gap-2">
        {meeting.join_url && !past && (
          <a
            href={meeting.join_url}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => {
              haptic.tap();
              openExternal(meeting.join_url!, e);
            }}
            className="rounded-full bg-[#A6E35A] px-5 py-2.5 text-[15px] font-semibold text-ink active:scale-[0.98]"
          >
            Join {modeLabel(meeting.mode)}
          </a>
        )}
        <a
          href={meeting.event_url ?? meeting.calendar_url}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => {
            haptic.tap();
            openExternal(meeting.event_url ?? meeting.calendar_url, e);
          }}
          className="rounded-full border border-dashed border-line-strong px-5 py-2.5 text-[15px] font-medium active:scale-[0.98]"
        >
          {meeting.event_url ? 'Open in Calendar' : 'Add to Google Calendar'}
        </a>
      </div>
    </section>
  );
}
