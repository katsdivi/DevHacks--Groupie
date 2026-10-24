import { tg } from './telegram.ts';

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Signed browser link token (`?t=`), only used outside Telegram. */
export function linkToken(): string | null {
  if (tg) return null;
  return new URLSearchParams(location.search).get('t') || null;
}

function authHeader(): Record<string, string> {
  if (tg) return { authorization: `tma ${tg.initData}` };
  const t = linkToken();
  return t ? { authorization: `link ${t}` } : {};
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...authHeader(),
      ...init.headers,
    },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, body?.error ?? 'error', body?.message ?? 'Something went sideways. Try again?');
  }
  return body as T;
}
