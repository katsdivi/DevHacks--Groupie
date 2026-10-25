import { useCallback, useEffect, useRef, useState } from 'react';
import { parseNickname, type MeResponse, type NicknameResponse, type PrefsResponse, type PrefsUpdateRequest } from '@groupie/shared';
import { api, ApiError } from '../api.ts';
import { haptic } from '../telegram.ts';
import { useMainButton } from '../useMainButton.ts';
import { DmStart } from '../components/DmStart.tsx';
import { ClearChatCard } from '../components/ClearChatCard.tsx';

export function Settings({ me, onRenamed }: { me: MeResponse; onRenamed: (nickname: string) => void }) {
  const [value, setValue] = useState(me.group.nickname);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const clean = parseNickname(value);
  const changed = clean !== null && clean !== me.group.nickname;

  const save = useCallback(async () => {
    if (!clean || !changed || saving) return;
    setSaving(true);
    setNote(null);
    try {
      const res = await api<NicknameResponse>(`/groups/${me.group.id}/nickname`, {
        method: 'PATCH',
        body: JSON.stringify({ nickname: clean }),
      });
      haptic.success();
      onRenamed(res.nickname);
      setNote({ kind: 'ok', text: `New name, who dis. I'm ${res.nickname} now. I told the group.` });
    } catch (e) {
      haptic.error();
      setNote({ kind: 'err', text: e instanceof ApiError ? e.message : 'Could not save. Try again?' });
    } finally {
      setSaving(false);
    }
  }, [clean, changed, saving, me.group.id, onRenamed]);

  const native = useMainButton({ text: changed ? `Call me ${clean}` : 'Save name', onClick: save, enabled: changed, loading: saving });

  return (
    <div className="px-5 pb-10">
      <h1 className="mt-8 text-[28px] font-bold tracking-tight">Settings</h1>
      <label className="mt-8 block text-[13px] font-medium uppercase tracking-widest text-muted" htmlFor="nick">
        My name in {me.group.title || 'this group'}
      </label>
      <input
        id="nick"
        value={value}
        maxLength={20}
        autoComplete="off"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && save()}
        className="mt-3 w-full rounded-2xl border border-dashed border-line-strong bg-panel px-4 py-4 text-[18px] font-semibold outline-none focus:border-text"
      />
      <p className={`mt-2 text-[13px] ${value && !clean ? 'text-[#FF6B5B]' : 'text-muted'}`}>
        {value && !clean ? 'Letters, numbers, spaces, and basic punctuation. 20 max.' : `${[...value.trim()].length}/20`}
      </p>
      {note && (
        <p className={`mt-6 animate-enter text-[15px] ${note.kind === 'ok' ? 'text-[#A6E35A]' : 'text-[#FF6B5B]'}`}>{note.text}</p>
      )}
      {!native && (
        <button
          disabled={!changed || saving}
          onClick={save}
          className="mt-8 w-full rounded-full bg-text py-4 text-[16px] font-semibold text-ink disabled:bg-line disabled:text-muted"
        >
          {saving ? 'Saving...' : changed ? `Call me ${clean}` : 'Save name'}
        </button>
      )}
      <Reminders />
      <ClearChatCard nickname={me.group.nickname} />
    </div>
  );
}

const OFFSET_CHOICES = [72, 48, 24, 12, 6, 3, 1];
const sectionLabel = 'block text-[13px] font-medium uppercase tracking-widest text-muted';
const timeInput =
  'mt-2 w-full rounded-2xl border border-dashed border-line-strong bg-panel px-4 py-3 text-[17px] font-semibold outline-none focus:border-text [color-scheme:dark]';

const isZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz.includes('/') || tz === 'UTC';
  } catch {
    return false;
  }
};

/** Reminder prefs: saved on every change, shown right away, rolled back if the server says no. */
function Reminders() {
  const [prefs, setPrefs] = useState<PrefsResponse | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingTz, setEditingTz] = useState(false);
  const [tzDraft, setTzDraft] = useState('');
  // The last state the server confirmed, so a failed save can roll back to it.
  const confirmed = useRef<PrefsResponse | null>(null);

  useEffect(() => {
    let live = true;
    api<PrefsResponse>('/me/prefs')
      .then((p) => {
        if (!live) return;
        confirmed.current = p;
        setPrefs(p);
      })
      .catch(() => live && setLoadError(true));
    return () => {
      live = false;
    };
  }, []);

  const save = useCallback(
    async (patch: PrefsUpdateRequest) => {
      if (!prefs) return;
      setError(null);
      setPrefs({ ...prefs, ...patch } as PrefsResponse);
      try {
        const res = await api<PrefsResponse>('/me/prefs', { method: 'PUT', body: JSON.stringify(patch) });
        confirmed.current = res;
        setPrefs(res);
      } catch (e) {
        haptic.error();
        setPrefs(confirmed.current);
        setError(e instanceof ApiError ? e.message : 'Could not save. Try again?');
      }
    },
    [prefs],
  );

  if (loadError) return <p className="mt-12 text-[15px] text-muted">Reminder settings did not load. Try again in a bit.</p>;
  if (!prefs) return <div className="mt-12 h-40 animate-shimmer rounded-2xl bg-panel" />;

  const on = prefs.reminders_enabled;
  const toggleOffset = (h: number) => {
    const has = prefs.reminder_offsets.includes(h);
    if (has && prefs.reminder_offsets.length === 1) return void haptic.error();
    if (!has && prefs.reminder_offsets.length >= 5) return void haptic.error();
    haptic.select();
    const next = has ? prefs.reminder_offsets.filter((o) => o !== h) : [...prefs.reminder_offsets, h];
    void save({ reminder_offsets: next.sort((a, b) => b - a) });
  };
  const saveTz = () => {
    const tz = tzDraft.trim();
    if (!isZone(tz)) return void setError('Use a time zone name like America/Phoenix.');
    setEditingTz(false);
    if (tz !== prefs.tz) void save({ tz });
  };

  return (
    <section className="mt-12">
      <div className="flex items-center justify-between">
        <h2 className="text-[22px] font-bold tracking-tight">Reminders</h2>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Reminders"
          onClick={() => {
            haptic.select();
            void save({ reminders_enabled: !on });
          }}
          className={`relative h-8 w-14 rounded-full transition-colors duration-150 ${on ? 'bg-[#A6E35A]' : 'bg-line'}`}
        >
          <span className={`absolute top-1 left-1 h-6 w-6 rounded-full bg-text transition-transform duration-150 ${on ? 'translate-x-6' : ''}`} />
        </button>
      </div>
      <p className="mt-2 text-[15px] text-muted">I'll DM you before your own deadlines and your group's due date.</p>

      <div className="mt-5">
        {prefs.can_dm ? (
          <p className="text-[15px] text-[#A6E35A]">Reminders reach you by DM.</p>
        ) : (
          <DmStart link={prefs.start_link} text="Start a chat so I can DM you" />
        )}
      </div>

      <div className={on ? '' : 'pointer-events-none opacity-40'} aria-disabled={!on}>
        <span className={`${sectionLabel} mt-8`}>Remind me before</span>
        <div className="mt-3 flex flex-wrap gap-2">
          {OFFSET_CHOICES.map((h) => {
            const picked = prefs.reminder_offsets.includes(h);
            return (
              <button
                key={h}
                type="button"
                aria-pressed={picked}
                onClick={() => toggleOffset(h)}
                className={`rounded-full border px-4 py-2.5 text-[15px] font-medium transition-all duration-150 active:scale-95 ${
                  picked ? 'border-transparent bg-text text-ink' : 'border-dashed border-line-strong text-text'
                }`}
              >
                {h} h
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[13px] text-muted">Pick 1 to 5.</p>

        <span className={`${sectionLabel} mt-8`}>Quiet hours</span>
        <div className="mt-1 grid grid-cols-2 gap-3">
          <label className="text-[13px] text-muted">
            From
            <input
              type="time"
              key={prefs.quiet_start}
              defaultValue={prefs.quiet_start}
              // Save once when the picker closes, not on every keystroke.
              onBlur={(e) => e.target.value && e.target.value !== prefs.quiet_start && void save({ quiet_start: e.target.value })}
              className={timeInput}
            />
          </label>
          <label className="text-[13px] text-muted">
            To
            <input
              type="time"
              key={prefs.quiet_end}
              defaultValue={prefs.quiet_end}
              // Save once when the picker closes, not on every keystroke.
              onBlur={(e) => e.target.value && e.target.value !== prefs.quiet_end && void save({ quiet_end: e.target.value })}
              className={timeInput}
            />
          </label>
        </div>
        <p className="mt-2 text-[13px] text-muted">No DMs in this window. Anything due waits until it ends.</p>

        <span className={`${sectionLabel} mt-8`}>Time zone</span>
        {editingTz ? (
          <div className="mt-3 flex gap-2">
            <input
              value={tzDraft}
              autoFocus
              autoComplete="off"
              placeholder="America/Phoenix"
              onChange={(e) => setTzDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveTz()}
              className="min-w-0 flex-1 rounded-2xl border border-dashed border-line-strong bg-panel px-4 py-3 text-[16px] outline-none focus:border-text"
            />
            <button type="button" onClick={saveTz} className="rounded-full bg-text px-5 font-semibold text-ink">
              Save
            </button>
          </div>
        ) : (
          <div className="mt-3 flex items-center justify-between">
            <span className="text-[17px] font-semibold">{prefs.tz.replace(/_/g, ' ')}</span>
            <button
              type="button"
              onClick={() => {
                setTzDraft(prefs.tz);
                setEditingTz(true);
              }}
              className="text-[14px] font-medium text-muted underline underline-offset-4 active:opacity-70"
            >
              Change
            </button>
          </div>
        )}
      </div>

      {error && <p className="mt-6 animate-enter text-[15px] text-[#FF6B5B]">{error}</p>}
    </section>
  );
}
