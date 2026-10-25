import { useState } from 'react';
import { api, ApiError } from '../api.ts';
import { haptic } from '../telegram.ts';

type State = 'idle' | 'confirm' | 'clearing' | 'done' | 'error';

/** Settings card: wipes the caller's bot DM and Mini App chat history, with an inline confirm. */
export function ClearChatCard({ nickname }: { nickname: string }) {
  const [state, setState] = useState<State>('idle');
  const [error, setError] = useState('');

  const clear = async () => {
    if (state === 'clearing') return;
    setState('clearing');
    try {
      await api<{ ok: true }>('/me/chat', { method: 'DELETE' });
      haptic.success();
      setState('done');
    } catch (e) {
      haptic.error();
      setError(e instanceof ApiError ? e.message : 'Could not clear it. Try again?');
      setState('error');
    }
  };

  return (
    <section className="mt-12">
      <h2 className="text-[22px] font-bold tracking-tight">Clear my chat with {nickname}</h2>
      <p className="mt-2 text-[15px] text-muted">
        Wipes our DM and the private chat here. Your tasks, reminders, and what I remember stay.
      </p>

      {state === 'confirm' || state === 'clearing' ? (
        <div className="mt-5 animate-enter rounded-2xl border border-dashed border-line-strong bg-panel p-4">
          <p className="text-[15px] font-semibold">Clear everything we said? This cannot be undone.</p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <button
              type="button"
              disabled={state === 'clearing'}
              onClick={() => {
                haptic.select();
                setState('idle');
              }}
              className="rounded-full border border-dashed border-line-strong py-3 text-[15px] font-semibold text-text active:scale-95 disabled:opacity-40"
            >
              Keep it
            </button>
            <button
              type="button"
              disabled={state === 'clearing'}
              onClick={() => void clear()}
              className="rounded-full bg-[#FF6B5B] py-3 text-[15px] font-semibold text-ink active:scale-95 disabled:opacity-60"
            >
              {state === 'clearing' ? 'Clearing...' : 'Yes, clear it'}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            haptic.tap();
            setError('');
            setState('confirm');
          }}
          className="mt-5 w-full rounded-full border border-dashed border-line-strong py-4 text-[16px] font-semibold text-[#FF6B5B] active:scale-95"
        >
          Clear my chat
        </button>
      )}

      {state === 'done' && <p className="mt-4 animate-enter text-[15px] text-[#A6E35A]">Done. Our chat is wiped; your tasks and reminders are untouched.</p>}
      {state === 'error' && <p className="mt-4 animate-enter text-[15px] text-[#FF6B5B]">{error}</p>}
    </section>
  );
}
