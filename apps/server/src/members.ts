import { and, eq } from 'drizzle-orm';
import { MEMBER_COLORS, type Member as MemberDto, type SkillTag } from '@groupie/shared';
import { db, schema } from './db/index.ts';
import type { Member } from './db/schema.ts';

const { members } = schema;

export function listMembers(groupId: number) {
  return db.select().from(members).where(eq(members.groupId, groupId)).orderBy(members.id).all();
}

export function getMemberByTgUser(groupId: number, tgUserId: number) {
  return db
    .select()
    .from(members)
    .where(and(eq(members.groupId, groupId), eq(members.tgUserId, tgUserId)))
    .get();
}

/** First palette color nobody in the group has yet, so colors follow join order. */
export function nextColor(taken: string[]): string {
  const free = MEMBER_COLORS.find((c) => !taken.includes(c.hex));
  return (free ?? MEMBER_COLORS[taken.length % MEMBER_COLORS.length]).hex;
}

type MemberInput = { name: string; email?: string; skills: SkillTag[]; weak_areas: SkillTag[] };

/** Creates the member, or updates their details if they already joined. Keeps their color. */
export function upsertMember(groupId: number, tgUserId: number | null, input: MemberInput, isSeed = false): Member {
  return db.transaction((tx) => {
    const existing =
      tgUserId === null
        ? undefined
        : tx
            .select()
            .from(members)
            .where(and(eq(members.groupId, groupId), eq(members.tgUserId, tgUserId)))
            .get();
    const values = {
      name: input.name,
      email: input.email ?? null,
      skills: input.skills,
      weakAreas: input.weak_areas,
    };
    if (existing) {
      return tx.update(members).set(values).where(eq(members.id, existing.id)).returning().get();
    }
    const taken = tx.select().from(members).where(eq(members.groupId, groupId)).all().map((m) => m.color);
    return tx
      .insert(members)
      .values({ ...values, groupId, tgUserId, isSeed, color: nextColor(taken), createdAt: new Date().toISOString() })
      .returning()
      .get();
  });
}

export const memberDto = (m: Member): MemberDto => ({
  id: m.id,
  name: m.name,
  color: m.color,
  email: m.email,
  skills: m.skills as SkillTag[],
  weak_areas: m.weakAreas as SkillTag[],
  is_seed: m.isSeed,
  share_workload: m.shareWorkload,
});

/** Turns the member's workload sharing on or off. */
export function setShareWorkload(memberId: number, shareWorkload: boolean): Member {
  return db.update(members).set({ shareWorkload }).where(eq(members.id, memberId)).returning().get()!;
}

const SEEDS: MemberInput[] = [
  { name: 'Ava', skills: ['writing', 'research'], weak_areas: ['coding'] },
  { name: 'Jay', skills: ['coding', 'data'], weak_areas: ['presenting'] },
  { name: 'Mia', skills: ['design', 'presenting'], weak_areas: ['math'] },
  { name: 'Leo', skills: ['math', 'data', 'coding'], weak_areas: ['writing'] },
  { name: 'Zoe', skills: ['editing', 'writing'], weak_areas: ['data'] },
];

/** Adds up to 4 fake members, never past the team size. Returns how many were added. */
export function seedMembers(groupId: number, teamSize: number): number {
  const current = listMembers(groupId);
  const room = Math.max(0, Math.min(4, teamSize - current.length));
  const names = new Set(current.map((m) => m.name));
  const picks = SEEDS.filter((s) => !names.has(s.name)).slice(0, room);
  for (const s of picks) upsertMember(groupId, null, s, true);
  return picks.length;
}
