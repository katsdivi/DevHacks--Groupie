import { colorName, type MeResponse, type Screen } from '@groupie/shared';
import { haptic } from '../telegram.ts';

function Row({ title, sub, onClick, accent }: { title: string; sub: string; onClick: () => void; accent?: string }) {
  return (
    <button
      className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left text-[16px] active:bg-panel"
      onClick={() => {
        haptic.tap();
        onClick();
      }}
    >
      <span className="flex items-center gap-3">
        {accent && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: accent }} />}
        <span>
          {title}
          <span className="block text-[13px] text-muted">{sub}</span>
        </span>
      </span>
      <span className="text-xl text-muted" aria-hidden>
        ›
      </span>
    </button>
  );
}

export function Home({ me, go }: { me: MeResponse; go: (s: Screen) => void }) {
  const { user, member, group } = me;
  const hasAssignment = group.status !== 'setup';
  return (
    <div className="px-5 pb-10">
      <h1 className="mt-8 text-[34px] font-bold leading-[1.1] tracking-tight">
        Hi {user.first_name},
        <br />
        <span className="text-muted">{group.nickname} is on </span>
        {group.title || 'your group'}
      </h1>

      {hasAssignment && (
        <section className="mt-8 rounded-3xl border border-dashed border-line-strong p-5">
          <div className="text-[13px] font-medium uppercase tracking-widest text-muted">Assignment</div>
          <div className="mt-2 text-[20px] font-semibold leading-snug">{group.assignment_title}</div>
          <div className="mt-1 text-[15px] text-muted">
            {group.task_count} tasks · {group.total_points} points · {group.joined}/{group.team_size} joined
          </div>
        </section>
      )}

      <section className="mt-4 rounded-3xl border border-dashed border-line-strong p-5">
        <div className="text-[13px] font-medium uppercase tracking-widest text-muted">Your color</div>
        <div className="mt-4 flex items-center gap-4">
          {member ? (
            <span className="h-11 w-11 rounded-full" style={{ background: member.color }} />
          ) : (
            <span className="h-11 w-11 rounded-full border-2 border-dashed border-line-strong" />
          )}
          <p className="text-[15px] leading-snug">
            {member ? (
              <>
                You're <span style={{ color: member.color }}>{colorName(member.color)}</span>.
                <span className="block text-muted">That's you on every card.</span>
              </>
            ) : (
              <>
                You get one when you add your details.
                <span className="block text-muted">Every card shows you in it.</span>
              </>
            )}
          </p>
        </div>
        {!member && hasAssignment && (
          <button
            className="mt-5 w-full rounded-full bg-text py-3.5 text-[16px] font-semibold text-ink active:scale-[0.98]"
            onClick={() => {
              haptic.tap();
              go('form');
            }}
          >
            Add my details
          </button>
        )}
        {!hasAssignment && (
          <p className="mt-4 text-[14px] text-muted">Drop the assignment in the group chat and the fun starts.</p>
        )}
      </section>

      <nav className="mt-4 divide-y divide-dashed divide-line overflow-hidden rounded-3xl border border-dashed border-line-strong">
        {member && <Row title="My details" sub="Name, email, skills" accent={member.color} onClick={() => go('form')} />}
        <Row title="Settings" sub={`Rename ${group.nickname} for this group`} onClick={() => go('settings')} />
      </nav>
    </div>
  );
}
