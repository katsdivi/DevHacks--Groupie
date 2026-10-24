import { useCallback, useState } from 'react';
import { parseNickname, type MeResponse, type NicknameResponse } from '@groupie/shared';
import { api, ApiError } from '../api.ts';
import { haptic } from '../telegram.ts';
import { useMainButton } from '../useMainButton.ts';

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
    </div>
  );
}
