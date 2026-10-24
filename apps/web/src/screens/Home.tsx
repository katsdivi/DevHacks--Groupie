import type { MeResponse } from '@groupie/shared';
import type { Screen } from '@groupie/shared';
import { haptic } from '../telegram.ts';

export function Home({ me, go }: { me: MeResponse; go: (s: Screen) => void }) {
  const { user, member, group } = me;
  return (
    <div className="px-5 pb-10">
      <h1 className="mt-8 text-[34px] font-bold leading-[1.1] tracking-tight">
        Hi {user.first_name},
        <br />
        <span className="text-muted">{group.nickname} is on </span>
        {group.title || 'your group'}
      </h1>

      <section className="mt-8 rounded-3xl border border-dashed border-line-strong p-5">
        <div className="text-[13px] font-medium uppercase tracking-widest text-muted">Your color</div>
        <div className="mt-4 flex items-center gap-4">
          {member ? (
            <span className="h-11 w-11 rounded-full" style={{ background: member.color }} />
          ) : (
            <span className="h-11 w-11 rounded-full border-2 border-dashed border-line-strong" />
          )}
          <p className="text-[15px] leading-snug">
            {member ? (
              <>This is you on every card.</>
            ) : (
              <>
                You get one when you add your details.
                <span className="block text-muted">Every card shows you in it.</span>
              </>
            )}
          </p>
        </div>
      </section>

      <nav className="mt-4 overflow-hidden rounded-3xl border border-dashed border-line-strong">
        <button
          className="flex w-full items-center justify-between px-5 py-4 text-left text-[16px] active:bg-panel"
          onClick={() => {
            haptic.tap();
            go('settings');
          }}
        >
          <span>
            Settings
            <span className="block text-[13px] text-muted">Rename {group.nickname} for this group</span>
          </span>
          <span className="text-xl text-muted" aria-hidden>
            ›
          </span>
        </button>
      </nav>
    </div>
  );
}
