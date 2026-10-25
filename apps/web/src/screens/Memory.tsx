import { useCallback, useEffect, useState } from 'react';
import type { MemoryCreateRequest, MemoryItem, MemoryListResponse, MemoryUpdateRequest, MeResponse, Screen } from '@groupie/shared';
import { api, ApiError } from '../api.ts';
import { haptic } from '../telegram.ts';
import { Bar } from '../components/Skeleton.tsx';

const label = 'text-[13px] font-medium uppercase tracking-widest text-muted';
const card = 'rounded-3xl border border-dashed border-line-strong';
const LIME = '#A6E35A';
const CORAL = '#FF6B5B';
const errText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

function MemorySkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading what I remember">
      {[0, 1, 2].map((i) => (
        <div key={i} className={`mt-3 ${card} border-line p-4`} style={{ animationDelay: `${i * 120}ms` }}>
          <Bar className="h-3 w-24" />
          <Bar className="mt-3 h-4 w-4/5" />
          <div className="mt-4 flex gap-2">
            <Bar className="h-8 w-40" />
            <Bar className="h-8 w-16" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Private / Shared with this group. Shared elsewhere shows as its own state until changed here. */
function VisibilityToggle({ item, groupId, busy, onChange }: { item: MemoryItem; groupId: number; busy: boolean; onChange: (shared: boolean) => void }) {
  const sharedHere = item.visibility === 'group' && item.group_chat_id === groupId;
  const elsewhere = item.visibility === 'group' && !sharedHere;
  const opt = (on: boolean, text: string, shared: boolean) => (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      disabled={busy}
      onClick={() => !on && onChange(shared)}
      className={`rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-colors disabled:opacity-60 ${on ? 'bg-text text-ink' : 'text-muted'}`}
    >
      {text}
    </button>
  );
  return (
    <div>
      <div role="radiogroup" aria-label="Who can see this" className="inline-flex rounded-full border border-line p-0.5">
        {opt(item.visibility === 'private', 'Private', false)}
        {opt(sharedHere, 'Shared with this group', true)}
      </div>
      {elsewhere && <p className="mt-1.5 text-[12px] text-muted">Shared with another group right now.</p>}
    </div>
  );
}

function MemoryRow({ item, groupId, onSaved, onDeleted }: { item: MemoryItem; groupId: number; onSaved: (m: MemoryItem) => void; onDeleted: (id: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.value);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patch = async (body: MemoryUpdateRequest) => {
    setBusy(true);
    setError(null);
    try {
      const updated = await api<MemoryItem>(`/me/memory/${item.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      haptic.success();
      onSaved(updated);
      setEditing(false);
    } catch (e) {
      haptic.error();
      setError(errText(e, 'Could not save. Try again?'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await api<null>(`/me/memory/${item.id}`, { method: 'DELETE' });
      haptic.success();
      onDeleted(item.id);
    } catch (e) {
      haptic.error();
      setError(errText(e, 'Could not delete. Try again?'));
      setBusy(false);
    }
  };

  const clean = draft.trim();
  return (
    <li className={`mt-3 animate-enter ${card} p-4`}>
      <div className="flex items-center justify-between gap-3">
        <span className="truncate text-[12px] font-semibold uppercase tracking-widest text-muted">{item.key}</span>
        <span className="shrink-0 rounded-full border border-line px-2.5 py-0.5 text-[11px] text-muted">
          {item.source === 'chat' ? 'From chat' : 'Added here'}
        </span>
      </div>
      {editing ? (
        <div className="mt-2">
          <textarea
            value={draft}
            maxLength={300}
            rows={2}
            autoFocus
            aria-label={`Edit ${item.key}`}
            onChange={(e) => setDraft(e.target.value)}
            className="w-full resize-none rounded-2xl border border-line-strong bg-panel px-3.5 py-3 text-[16px] outline-none focus:border-text"
          />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={busy || !clean || clean === item.value}
              onClick={() => patch({ value: clean })}
              className="rounded-full bg-text px-4 py-2 text-[14px] font-semibold text-ink disabled:opacity-50"
            >
              {busy ? 'Saving...' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(item.value);
                setEditing(false);
              }}
              className="rounded-full px-4 py-2 text-[14px] text-muted"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setEditing(true)} className="mt-1.5 block w-full text-left text-[16px] leading-snug" aria-label={`Edit: ${item.value}`}>
          {item.value}
        </button>
      )}
      <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2">
        <VisibilityToggle
          item={item}
          groupId={groupId}
          busy={busy}
          onChange={(shared) => patch(shared ? { visibility: 'group', group_chat_id: groupId } : { visibility: 'private', group_chat_id: null })}
        />
        {confirming ? (
          <span className="flex items-center gap-1 text-[13px]">
            <span className="text-muted">Delete?</span>
            <button type="button" disabled={busy} onClick={remove} className="rounded-full px-3 py-1.5 font-semibold" style={{ color: CORAL }}>
              Yes, delete
            </button>
            <button type="button" onClick={() => setConfirming(false)} className="rounded-full px-3 py-1.5 text-muted">
              Keep
            </button>
          </span>
        ) : (
          <button type="button" onClick={() => setConfirming(true)} className="rounded-full px-3 py-1.5 text-[13px] text-muted">
            Delete
          </button>
        )}
      </div>
      {error && <p className="mt-2 text-[13px]" style={{ color: CORAL }}>{error}</p>}
    </li>
  );
}

function AddFact({ onAdded }: { onAdded: (m: MemoryItem) => void }) {
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ok = key.trim() && value.trim();

  const add = async () => {
    if (!ok || busy) return;
    setBusy(true);
    setError(null);
    try {
      const body: MemoryCreateRequest = { key: key.trim(), value: value.trim(), visibility: 'private' };
      onAdded(await api<MemoryItem>('/me/memory', { method: 'POST', body: JSON.stringify(body) }));
      haptic.success();
      setKey('');
      setValue('');
    } catch (e) {
      haptic.error();
      setError(errText(e, 'Could not add that. Try again?'));
    } finally {
      setBusy(false);
    }
  };

  const input = 'w-full rounded-2xl border border-line bg-panel px-3.5 py-3 text-[16px] outline-none focus:border-text';
  return (
    <form
      className={`mt-8 ${card} p-4`}
      onSubmit={(e) => {
        e.preventDefault();
        void add();
      }}
    >
      <p className={label}>Add a fact</p>
      <input value={key} maxLength={60} onChange={(e) => setKey(e.target.value)} placeholder="Label, like work schedule" aria-label="Label" className={`mt-3 ${input}`} />
      <input value={value} maxLength={300} onChange={(e) => setValue(e.target.value)} placeholder="I work Tuesday and Thursday nights" aria-label="Fact" className={`mt-2 ${input}`} />
      <button type="submit" disabled={!ok || busy} className="mt-3 w-full rounded-full bg-text py-3 text-[15px] font-semibold text-ink disabled:opacity-50">
        {busy ? 'Adding...' : 'Add privately'}
      </button>
      {error && <p className="mt-2 text-[13px]" style={{ color: CORAL }}>{error}</p>}
    </form>
  );
}

/** Step 18a: what Groupie remembers about you, private by default, shareable with this group. */
export function Memory({ me }: { me: MeResponse; go: (s: Screen) => void }) {
  const nick = me.group.nickname;
  const [items, setItems] = useState<MemoryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setItems((await api<MemoryListResponse>('/me/memory')).items);
    } catch (e) {
      setError(errText(e, `Could not load what ${nick} remembers.`));
    }
  }, [nick]);

  useEffect(() => {
    void load();
  }, [load]);

  const replace = (m: MemoryItem) => setItems((xs) => (xs ?? []).map((x) => (x.id === m.id ? m : x)));
  const shared = items?.filter((i) => i.visibility === 'group' && i.group_chat_id === me.group.id).length ?? 0;

  return (
    <div className="mx-auto max-w-xl px-5 pb-12">
      <h1 className="mt-8 text-[28px] font-bold tracking-tight">What {nick} remembers</h1>
      <p className="mt-2 text-[15px] leading-snug text-muted">Private by default. Shared facts are visible to {nick}'s answers in this group only.</p>
      {items && items.length > 0 && (
        <p className="mt-4 text-[13px] text-muted">
          <span style={{ color: LIME }}>{shared} shared</span> with {me.group.title || 'this group'}, {items.length - shared} private
        </p>
      )}

      {error && (
        <div className={`mt-6 ${card} p-4`} role="alert">
          <p className="text-[15px]" style={{ color: CORAL }}>{error}</p>
          <button type="button" onClick={load} className="mt-3 rounded-full border border-dashed border-line-strong px-4 py-2 text-[14px]">
            Try again
          </button>
        </div>
      )}
      {!items && !error && <MemorySkeleton />}
      {items && items.length === 0 && (
        <div className={`mt-6 ${card} px-5 py-8 text-center`}>
          <p className="text-[17px] font-semibold">Nothing yet</p>
          <p className="mt-1.5 text-[14px] leading-snug text-muted">
            Tell {nick} in your private chat, like "remember I work Tuesday nights", or add a fact below.
          </p>
        </div>
      )}
      {items && items.length > 0 && (
        <ul className="mt-3">
          {items.map((item) => (
            <MemoryRow key={item.id} item={item} groupId={me.group.id} onSaved={replace} onDeleted={(id) => setItems((xs) => (xs ?? []).filter((x) => x.id !== id))} />
          ))}
        </ul>
      )}
      {items && <AddFact onAdded={(m) => setItems((xs) => [...(xs ?? []), m])} />}
    </div>
  );
}
