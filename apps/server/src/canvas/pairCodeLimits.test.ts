import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PAIR_CODE_TTL_MS } from '@groupie/shared';
import { resetRateLimits, takeRateLimit } from './importer.ts';
import { createPairCode } from './pairCodes.ts';
import { PAIR_CODE_RATE_LIMITS } from './routes.ts';
import { startTestApp } from './testApp.ts';

const USER = 7070;
let app: Awaited<ReturnType<typeof startTestApp>>;

beforeAll(async () => {
  app = await startTestApp();
});
afterAll(() => app.close());
beforeEach(() => resetRateLimits());
afterEach(() => vi.useRealTimers());

async function call(method: 'GET' | 'POST', path: string, ip: string) {
  const res = await fetch(`${app.base}/api${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': String(USER), 'x-forwarded-for': ip },
    body: method === 'POST' ? '{}' : undefined,
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe('pair code rate limits', () => {
  it('limits creates per IP with 429 rate_limited', async () => {
    const { limit } = PAIR_CODE_RATE_LIMITS.createPerIp;
    for (let i = 0; i < limit; i++) expect((await call('POST', '/cubbie/pair-code', '10.1.0.1')).status).toBe(200);
    const r = await call('POST', '/cubbie/pair-code', '10.1.0.1');
    expect(r.status).toBe(429);
    expect(r.body).toMatchObject({ error: 'rate_limited' });
    expect(typeof r.body.message).toBe('string');
    expect((await call('POST', '/cubbie/pair-code', '10.1.0.2')).status).toBe(200);
  });

  it('limits creates globally across IPs', async () => {
    const { limit, windowMs } = PAIR_CODE_RATE_LIMITS.createGlobal;
    const now = Date.now();
    for (let i = 0; i < limit - 1; i++) takeRateLimit('pc-create-all', limit, now, windowMs);
    expect((await call('POST', '/cubbie/pair-code', '10.2.0.1')).status).toBe(200);
    const r = await call('POST', '/cubbie/pair-code', '10.2.0.2');
    expect(r).toMatchObject({ status: 429, body: { error: 'rate_limited' } });
  });

  it('limits status polls per IP', async () => {
    const pc = createPairCode(USER, null);
    const { limit } = PAIR_CODE_RATE_LIMITS.statusPerIp;
    for (let i = 0; i < limit; i++) takeRateLimit('pc-status-ip:10.3.0.1', limit, Date.now(), PAIR_CODE_RATE_LIMITS.statusPerIp.windowMs);
    expect((await call('GET', `/cubbie/pair-code/${pc.code}`, '10.3.0.1')).status).toBe(429);
    expect((await call('GET', `/cubbie/pair-code/${pc.code}`, '10.3.0.2')).status).toBe(200);
  });

  it('lets the Mini App poll every 2.5 s for the whole code lifetime from one IP', async () => {
    const pc = createPairCode(USER, null);
    vi.useFakeTimers({ toFake: ['Date'] });
    const start = Date.now();
    const polls = PAIR_CODE_TTL_MS / 2500;
    for (let i = 0; i < polls; i++) {
      vi.setSystemTime(start + i * 2500);
      const r = await call('GET', `/cubbie/pair-code/${pc.code}`, '10.4.0.1');
      expect(r.status).toBe(200);
    }
  });
});
