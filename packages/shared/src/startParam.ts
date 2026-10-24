export const SCREENS = ['home', 'form', 'split', 'avail', 'progress', 'chat', 'settings'] as const;
export type Screen = (typeof SCREENS)[number];

/**
 * Telegram start_param allows only A-Za-z0-9_- (max 64 chars).
 * Group ids are always negative, so we drop the minus: g<abs id>_<screen>.
 */
export function encodeStartParam(groupId: number, screen: Screen): string {
  return `g${Math.abs(groupId)}_${screen}`;
}

export function decodeStartParam(param: string | undefined | null): { groupId: number; screen: Screen } | null {
  const m = /^g(\d{1,20})_([a-z]+)$/.exec(param ?? '');
  if (!m) return null;
  const screen = (SCREENS as readonly string[]).includes(m[2]) ? (m[2] as Screen) : 'home';
  return { groupId: -Number(m[1]), screen };
}
