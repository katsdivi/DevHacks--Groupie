import type { MeResponse, Screen } from '@groupie/shared';

/** Step 18a: connect Google (free/busy) or paste an ICS link (CAL agent fills this in). */
export function CalendarConnect({ me }: { me: MeResponse; go: (s: Screen) => void }) {
  return <div className="px-5 pt-10 text-muted">{me.group.nickname} is building this screen.</div>;
}
