import express from 'express';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GO_CUBBIE_MAX_TEXT, goCubbiePath } from '@groupie/shared';
import { env } from '../env.ts';
import { GO_COPY, goCubbiePage, goText, renderGoPage, safeHandle, smsLink } from './goPage.ts';
import { cubbieOpenUrl } from './goCubbie.ts';

let base = '';
let close: () => Promise<void>;

beforeAll(async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const app = express();
  app.get('/go/cubbie', goCubbiePage);
  const server = app.listen(0);
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => new Promise<void>((r) => server.close(() => r()));
});
afterAll(() => close());
beforeEach(() => {
  env.cubbieHandle = '';
});

const get = async (query: string) => {
  const res = await fetch(`${base}/go/cubbie${query}`);
  return { res, html: await res.text() };
};

describe('/go/cubbie', () => {
  it('escapes the text and never reflects other params', async () => {
    const evil = '<script>alert(1)</script>"&\'';
    const { res, html } = await get(`?text=${encodeURIComponent(evil)}&other=${encodeURIComponent('<b>zzz</b>')}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(html).not.toContain('<script>alert(1)');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;&quot;&amp;&#39;');
    expect(html).not.toContain('zzz');
  });

  it('caps the text at 500 characters', async () => {
    const long = 'a'.repeat(GO_CUBBIE_MAX_TEXT) + 'TAILXYZ';
    const { html } = await get(`?text=${long}`);
    expect(html).toContain('a'.repeat(GO_CUBBIE_MAX_TEXT));
    expect(html).not.toContain('TAILXYZ');
    expect(goText('😀'.repeat(600))).toBe('😀'.repeat(GO_CUBBIE_MAX_TEXT));
  });

  it('includes the sms link when CUBBIE_HANDLE is set', async () => {
    env.cubbieHandle = '+15551234567';
    const { html } = await get(`?text=${encodeURIComponent('Groupie import K7Q2MX Project 2')}`);
    expect(html).toContain('href="sms:+15551234567&amp;body=Groupie%20import%20K7Q2MX%20Project%202"');
    expect(html).toContain(GO_COPY.open);
    expect(html).not.toContain(GO_COPY.noHandle);
    expect(html).toContain('id="copy"');
  });

  it('omits the sms link when CUBBIE_HANDLE is unset or unsafe', async () => {
    for (const h of ['', 'bad handle"><x']) {
      env.cubbieHandle = h;
      const { html } = await get('?text=Groupie%20status');
      expect(html).not.toContain('sms:');
      expect(html).not.toContain(GO_COPY.open);
      expect(html).toContain(GO_COPY.noHandle);
      expect(html).toContain('Groupie status');
      expect(html).toContain('id="copy"');
    }
  });

  it('takes only a string text (arrays become empty) and adds no CSP or framing header', async () => {
    const { res, html } = await get('?text=a&text=b');
    expect(html).toContain(GO_COPY.empty);
    expect(res.headers.get('content-security-policy')).toBeNull();
    expect(res.headers.get('x-frame-options')).toBeNull();
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('has no external assets', () => {
    const html = renderGoPage('hi', '+15550000000');
    expect(html).not.toMatch(/<(link|img)\b/);
    expect(html).not.toMatch(/src=/);
    expect(html).not.toMatch(/https?:\/\//);
  });

  it('builds the iOS sms form and agrees with the shared URL helpers', () => {
    expect(smsLink('cubbie@icloud.com', 'a b&c')).toBe('sms:cubbie@icloud.com&body=a%20b%26c');
    expect(safeHandle(' +1 (555) 123-4567 ')).toBe('+15551234567');
    expect(safeHandle('a b')).toBe('');
    expect(safeHandle('+15551234567')).toBe('+15551234567');
    expect(cubbieOpenUrl('Groupie import K7Q2MX')).toBe(`${env.publicUrl}${goCubbiePath('Groupie import K7Q2MX')}`);
  });
});
