import { useCallback, useEffect, useState } from 'react';
import {
  colorName,
  MEMBER_COLORS,
  MemberRequest,
  type MeResponse,
  type MemberResponse,
  type PrefsResponse,
  type SkillTag,
} from '@groupie/shared';
import { api, ApiError } from '../api.ts';
import { haptic, tg } from '../telegram.ts';
import { useMainButton } from '../useMainButton.ts';
import { Chips } from '../components/Chips.tsx';
import { DmStart } from '../components/DmStart.tsx';

type Props = { me: MeResponse; onSaved: (res: MemberResponse) => void };

const label = 'block text-[13px] font-medium uppercase tracking-widest text-muted';
const input =
  'mt-3 w-full rounded-2xl border border-dashed border-line-strong bg-panel px-4 py-4 text-[17px] outline-none placeholder:text-[#666] focus:border-text';

export function Form({ me, onSaved }: Props) {
  // Captured once: after saving, `me.member` is set, but this visit was still a first join.
  const [existing] = useState(me.member);
  const defaultName = [me.user.first_name, me.user.last_name].filter(Boolean).join(' ');
  const [name, setName] = useState(existing?.name ?? defaultName);
  const [email, setEmail] = useState(existing?.email ?? '');
  const [skills, setSkills] = useState<SkillTag[]>(existing?.skills ?? []);
  const [weak, setWeak] = useState<SkillTag[]>(existing?.weak_areas ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<MemberResponse | null>(null);
  const [prefs, setPrefs] = useState<PrefsResponse | null>(null);

  // After joining, check whether the bot can DM them; if not, offer the /start reminders link.
  useEffect(() => {
    if (!done) return;
    let live = true;
    api<PrefsResponse>('/me/prefs')
      .then((p) => live && setPrefs(p))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [done]);

  // Preview the color they'll get (the server has the final say).
  const accent = existing?.color ?? MEMBER_COLORS[Math.min(me.group.joined, MEMBER_COLORS.length - 1)].hex;

  const toggle = (list: SkillTag[], set: (v: SkillTag[]) => void, other: SkillTag[], setOther: (v: SkillTag[]) => void) =>
    (tag: SkillTag) => {
      if (list.includes(tag)) set(list.filter((t) => t !== tag));
      else {
        set([...list, tag]);
        if (other.includes(tag)) setOther(other.filter((t) => t !== tag));
      }
    };

  const parsed = MemberRequest.safeParse({ name, email, skills, weak_areas: weak });
  const valid = parsed.success;

  const submit = useCallback(async () => {
    if (done) {
      tg?.close();
      return;
    }
    const check = MemberRequest.safeParse({ name, email, skills, weak_areas: weak });
    if (!check.success) {
      haptic.error();
      setError(check.error.issues[0]?.message ?? 'Check your details.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await api<MemberResponse>(`/groups/${me.group.id}/members`, {
        method: 'POST',
        body: JSON.stringify({ name, email, skills, weak_areas: weak }),
      });
      haptic.success();
      setDone(res);
      onSaved(res);
    } catch (e) {
      haptic.error();
      setError(e instanceof ApiError ? e.message : 'Could not save. Try again?');
    } finally {
      setSaving(false);
    }
  }, [done, name, email, skills, weak, me.group.id, onSaved]);

  const native = useMainButton({
    text: done ? 'Back to the group' : existing ? 'Save my details' : 'Join the team',
    onClick: submit,
    enabled: done ? true : valid,
    loading: saving,
  });

  if (done) {
    const nick = me.group.nickname;
    return (
      <div className="flex flex-col items-center px-6 pt-14 pb-10 text-center">
        <div className="relative">
          <span className="absolute inset-0 animate-ping rounded-full opacity-30" style={{ background: done.member.color }} />
          <span className="relative block h-24 w-24 rounded-full" style={{ background: done.member.color }} />
        </div>
        <h1 className="mt-8 text-[30px] font-bold tracking-tight">{existing ? 'Saved!' : "You're in!"}</h1>
        <p className="mt-2 max-w-xs text-[16px] leading-relaxed text-muted">
          You're <span style={{ color: done.member.color }}>{colorName(done.member.color)}</span> on every card. {nick}{' '}
          is so proud of this team already.
        </p>
        <div className="mt-8 rounded-full border border-dashed border-line-strong px-5 py-2 text-[15px]">
          <b>
            {done.joined}/{done.team_size}
          </b>{' '}
          joined
        </div>
        {prefs && !prefs.can_dm && (
          <div className="mt-8 w-full max-w-sm animate-enter">
            <DmStart link={prefs.start_link} />
          </div>
        )}
        {!native && (
          <button onClick={submit} className="mt-8 rounded-full bg-text px-6 py-3 font-semibold text-ink">
            Back to the group
          </button>
        )}
      </div>
    );
  }

  return (
    <form
      className="px-5 pb-12"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <h1 className="mt-6 text-[28px] font-bold tracking-tight">{existing ? 'Your details' : 'Join the team'}</h1>
      <p className="mt-1 text-[15px] text-muted">
        {me.group.nickname} uses this to split {me.group.assignment_title ?? 'the work'} fairly.
      </p>

      <label className={`${label} mt-8`} htmlFor="name">
        Name
      </label>
      <input id="name" className={input} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} autoComplete="name" />

      <label className={`${label} mt-6`} htmlFor="email">
        Email <span className="normal-case tracking-normal">(optional)</span>
      </label>
      <input
        id="email"
        type="email"
        inputMode="email"
        className={input}
        placeholder="you@school.edu"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        autoComplete="email"
      />
      <p className="mt-2 text-[13px] text-muted">Only for the meeting invite.</p>

      <div className={`${label} mt-8`}>What are you good at?</div>
      <div className="mt-3">
        <Chips selected={skills} onToggle={toggle(skills, setSkills, weak, setWeak)} accent={accent} elsewhere={weak} />
      </div>

      <div className={`${label} mt-8`}>What would you rather avoid?</div>
      <div className="mt-3">
        <Chips selected={weak} onToggle={toggle(weak, setWeak, skills, setSkills)} accent="#F5F5F5" elsewhere={skills} />
      </div>

      {error && <p className="mt-6 animate-enter text-[15px] text-[#FF6B5B]">{error}</p>}

      {!native && (
        <button
          type="submit"
          disabled={!valid || saving}
          className="mt-10 w-full rounded-full bg-text py-4 text-[16px] font-semibold text-ink disabled:bg-line disabled:text-muted"
        >
          {saving ? 'Saving...' : existing ? 'Save my details' : 'Join the team'}
        </button>
      )}
    </form>
  );
}
