import type { MeResponse, Screen } from '@groupie/shared';

/** Step 18a: what Groupie remembers about you, with visibility and delete (POLICY agent fills this in). */
export function Memory({ me }: { me: MeResponse; go: (s: Screen) => void }) {
  return <div className="px-5 pt-10 text-muted">{me.group.nickname} is building this screen.</div>;
}
