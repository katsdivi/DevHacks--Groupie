import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { SKILL_TAGS } from '@groupie/shared';

/**
 * The demo team fixture: `demo.config.json` at the repo root (gitignored; see
 * demo.config.example.json). Members with a null telegramUserId are pretend teammates.
 * Pure: no database imports, so the CLI can load it before the guards run.
 */

const Skill = z.enum(SKILL_TAGS);

export const DemoMember = z.object({
  role: z.string().min(1),
  telegramUserId: z.number().int().nullable(),
  name: z.string().trim().min(1).max(40),
  skills: z.array(Skill).default([]),
  weakAreas: z.array(Skill).default([]),
  shareWorkload: z.boolean().default(false),
  /** busy-week: a packed afternoon block every weekday plus a heavy Canvas week. light: a few hours. none: nothing. */
  calendar: z.enum(['busy-week', 'light', 'none']).default('light'),
});
export type DemoMember = z.infer<typeof DemoMember>;

export const DemoConfig = z
  .object({
    admins: z.array(z.number().int()).default([]),
    group: z.object({
      title: z.string().default('Demo group'),
      teamSize: z.number().int().min(2).max(6),
      nickname: z.string().trim().min(1).max(20).optional(),
      course: z.string().min(1),
      assignmentTitle: z.string().min(1).max(120),
      dueInDays: z.number().int().min(1).max(60),
    }),
    members: z.array(DemoMember).min(1),
  })
  .refine((c) => c.members.length <= c.group.teamSize, { message: 'more members than group.teamSize' })
  .refine((c) => c.members.filter((m) => m.role === 'presenter').length === 1, { message: 'exactly one member must have role "presenter"' })
  .refine((c) => c.members.find((m) => m.role === 'presenter')?.telegramUserId != null, { message: 'the presenter needs a real telegramUserId' });
export type DemoConfig = z.infer<typeof DemoConfig>;

/** Repo root, found from this file (apps/server/src/demo). */
export const repoRoot = () => path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

/**
 * Loads the config from, in order: an explicit path, DEMO_CONFIG_JSON (base64 JSON, used by
 * scripts/demo/remote.sh since the gitignored file is not in the container), or <repo>/demo.config.json.
 * Returns null when none exists. Throws on invalid content.
 */
export function loadConfig(explicitPath: string | undefined, vars: Record<string, string | undefined> = process.env): DemoConfig | null {
  let raw: string | null = null;
  // Relative paths are from where the operator ran pnpm (INIT_CWD), not apps/server.
  if (explicitPath) raw = fs.readFileSync(path.resolve(vars.INIT_CWD ?? process.cwd(), explicitPath), 'utf8');
  else if (vars.DEMO_CONFIG_JSON) raw = Buffer.from(vars.DEMO_CONFIG_JSON, 'base64').toString('utf8');
  else {
    const file = path.join(repoRoot(), 'demo.config.json');
    if (fs.existsSync(file)) raw = fs.readFileSync(file, 'utf8');
  }
  if (raw === null) return null;
  const parsed = DemoConfig.safeParse(JSON.parse(raw));
  if (!parsed.success) throw new Error(`demo config is invalid: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'} ${i.message}`).join('; ')}`);
  return parsed.data;
}

export const presenterOf = (c: DemoConfig) => c.members.find((m) => m.role === 'presenter')!;
