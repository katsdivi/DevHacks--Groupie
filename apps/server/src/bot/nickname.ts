const ALLOWED = /^[\p{L}\p{N} .,'!?&()_-]+$/u;
const HAS_WORD_CHAR = /[\p{L}\p{N}]/u;

/** Returns the cleaned nickname, or null if it isn't allowed. */
export function parseNickname(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, ' ');
  if (name.length < 1 || [...name].length > 20) return null;
  if (!ALLOWED.test(name) || !HAS_WORD_CHAR.test(name)) return null;
  return name;
}
