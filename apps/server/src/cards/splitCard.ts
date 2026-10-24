import { readFileSync } from 'node:fs';

export type SplitCardData = {
  assignmentTitle: string;
  dueLabel: string | null; // e.g. "Fri, Nov 20", already formatted
  nickname: string; // bot nickname for the footer, e.g. "Motu"
  maxGap: number;
  members: { name: string; color: string; points: number; tasks: { title: string; effort: number }[] }[];
};

export const BRAND_COLORS = ['#FF6B5B', '#FFB547', '#A6E35A', '#4FD8E8', '#A88BFF', '#FF7AC6'];

/** Inter variable font, read once and inlined so rendering never hits the network. */
function fontDataUrl(file: string): string {
  const buf = readFileSync(new URL(`../../assets/fonts/${file}`, import.meta.url));
  return `data:font/woff2;base64,${buf.toString('base64')}`;
}

const FONT_FACES = `
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-display: block;
  font-weight: 100 900;
  src: url(${fontDataUrl('inter-latin-ext-wght-normal.woff2')}) format('woff2');
  unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF;
}
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-display: block;
  font-weight: 100 900;
  src: url(${fontDataUrl('inter-latin-wght-normal.woff2')}) format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}`;

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Only allow plain hex colors into CSS; anything else falls back to the palette. */
function safeColor(color: string, i: number): string {
  return /^#[0-9a-f]{3,8}$/i.test(color) ? color : BRAND_COLORS[i % BRAND_COLORS.length];
}

const pts = (n: number) => `${n} ${n === 1 ? 'pt' : 'pts'}`;

const CSS = `
${FONT_FACES}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { background: #141414; }
body {
  padding: 40px;
  font-family: 'Inter', sans-serif;
  color: #F5F5F5;
  -webkit-font-smoothing: antialiased;
  font-feature-settings: 'cv11';
}
.card {
  width: 1080px;
  background: #1E1E1E;
  border: 2px dashed #4A4A4A;
  border-radius: 24px;
  padding: 52px 56px 44px;
  position: relative;
  overflow: hidden;
}
.glow {
  position: absolute; inset: 0; pointer-events: none;
  background:
    radial-gradient(600px 260px at 0% 0%, rgba(255,255,255,0.035), transparent 70%),
    radial-gradient(500px 240px at 100% 0%, rgba(168,139,255,0.06), transparent 70%);
}
.top { display: flex; align-items: center; justify-content: space-between; gap: 24px; position: relative; }
.brand { display: flex; align-items: center; gap: 14px; }
.dots { display: grid; grid-template-columns: repeat(3, 10px); gap: 5px; }
.dots i { width: 10px; height: 10px; border-radius: 50%; display: block; }
.brand-name { font-size: 22px; font-weight: 700; letter-spacing: -0.02em; }
.badge {
  flex: none;
  display: inline-flex; align-items: center; gap: 10px;
  padding: 10px 18px 10px 14px;
  border-radius: 999px;
  border: 1.5px dashed #555;
  font-size: 17px; font-weight: 600; letter-spacing: 0.01em;
  color: #F5F5F5;
  background: rgba(255,255,255,0.03);
}
.badge svg { display: block; }
.title {
  margin-top: 40px;
  font-size: 50px; line-height: 1.08; font-weight: 750; letter-spacing: -0.035em;
  position: relative;
  overflow-wrap: anywhere;
}
.title.long { font-size: 40px; line-height: 1.14; letter-spacing: -0.03em; }
.meta { margin-top: 18px; display: flex; flex-wrap: wrap; gap: 10px 26px; color: #9A9A9A; font-size: 19px; font-weight: 500; position: relative; }
.meta > span { display: inline-flex; align-items: center; gap: 9px; }
.meta b { color: #F5F5F5; font-weight: 600; }
.rows { margin-top: 36px; border-top: 2px dashed #3A3A3A; position: relative; }
.row {
  display: grid;
  grid-template-columns: 210px 1fr 112px;
  column-gap: 28px;
  padding: 26px 0 28px;
  border-bottom: 2px dashed #3A3A3A;
}
.who { display: flex; align-items: center; gap: 14px; min-width: 0; align-self: start; padding-top: 3px; }
.avatar {
  flex: none; width: 44px; height: 44px; border-radius: 14px;
  display: grid; place-items: center;
  background: var(--c); color: #1E1E1E;
  font-size: 20px; font-weight: 800;
}
.name {
  font-size: 22px; line-height: 1.2; font-weight: 650; letter-spacing: -0.015em;
  overflow-wrap: anywhere;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.work { min-width: 0; }
.pills { display: flex; flex-wrap: wrap; gap: 8px; }
.pill {
  display: inline-flex; align-items: center; gap: 8px;
  max-width: 100%;
  height: 36px; padding: 0 6px 0 14px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--c) 9%, #262626);
  border: 1px solid color-mix(in srgb, var(--c) 26%, transparent);
  font-size: 16px; font-weight: 500; color: #EDEDED;
}
.pill .t { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.pill .p {
  flex: none;
  min-width: 24px; height: 24px; padding: 0 7px;
  border-radius: 7px;
  display: grid; place-items: center;
  background: color-mix(in srgb, var(--c) 22%, transparent);
  color: var(--c);
  font-size: 14px; font-weight: 700;
}
.empty { color: #6A6A6A; font-size: 16px; font-style: italic; height: 36px; display: flex; align-items: center; }
.bar { margin-top: 18px; height: 10px; border-radius: 999px; background: #2A2A2A; overflow: hidden; }
.bar i { display: block; height: 100%; border-radius: 999px; background: var(--c); box-shadow: 0 0 18px color-mix(in srgb, var(--c) 45%, transparent); }
.total { text-align: right; align-self: start; padding-top: 1px; }
.total .n { font-variant-numeric: tabular-nums; font-size: 40px; font-weight: 750; letter-spacing: -0.04em; line-height: 1; }
.total .u { margin-top: 6px; font-size: 14px; font-weight: 600; color: #9A9A9A; text-transform: uppercase; letter-spacing: 0.12em; }
.foot { margin-top: 30px; display: flex; align-items: center; justify-content: space-between; gap: 20px; font-size: 19px; color: #9A9A9A; font-weight: 500; position: relative; }
.foot .gap { display: inline-flex; align-items: center; gap: 12px; }
.foot .gap b { color: #F5F5F5; font-weight: 650; }
.foot .gap .ok { width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; background: rgba(166,227,90,0.14); }
.foot .by { display: inline-flex; align-items: center; gap: 10px; }
.foot .by b { color: #F5F5F5; font-weight: 650; }
.mini { display: inline-flex; gap: 4px; }
.mini i { width: 7px; height: 7px; border-radius: 50%; display: block; }
`;

const dots = (cls: string) =>
  `<span class="${cls}">${BRAND_COLORS.map((c) => `<i style="background:${c}"></i>`).join('')}</span>`;

const CHECK = (color: string, size: number) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`;

const CALENDAR = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9A9A9A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>`;

const LIST = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9A9A9A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/></svg>`;

const PEOPLE = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9A9A9A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.8a3.5 3.5 0 0 1 0 6.4M18.5 14.8c1.6.8 2.6 2.5 3 5.2"/></svg>`;

export function splitCardHtml(data: SplitCardData): string {
  const members = data.members.map((m, i) => ({ ...m, color: safeColor(m.color, i) }));
  const maxPoints = Math.max(1, ...members.map((m) => m.points));
  const taskCount = members.reduce((n, m) => n + m.tasks.length, 0);
  const totalPoints = members.reduce((n, m) => n + m.points, 0);

  const rows = members
    .map((m) => {
      const initial = escapeHtml(Array.from(m.name.trim())[0]?.toUpperCase() ?? '?');
      const pills = m.tasks.length
        ? m.tasks
            .map(
              (t) =>
                `<span class="pill"><span class="t">${escapeHtml(t.title)}</span><span class="p">${t.effort}</span></span>`,
            )
            .join('')
        : '<span class="empty">No tasks yet</span>';
      const width = Math.max(2, Math.round((m.points / maxPoints) * 1000) / 10);
      return `<div class="row" style="--c:${m.color}">
  <div class="who"><span class="avatar">${initial}</span><span class="name">${escapeHtml(m.name)}</span></div>
  <div class="work"><div class="pills">${pills}</div><div class="bar"><i style="width:${width}%"></i></div></div>
  <div class="total"><div class="n">${m.points}</div><div class="u">${m.points === 1 ? 'point' : 'points'}</div></div>
</div>`;
    })
    .join('\n');

  const meta = [
    data.dueLabel ? `<span>${CALENDAR}<span>Due <b>${escapeHtml(data.dueLabel)}</b></span></span>` : '',
    `<span>${LIST}<span><b>${taskCount}</b> ${taskCount === 1 ? 'task' : 'tasks'} · <b>${totalPoints}</b> ${totalPoints === 1 ? 'point' : 'points'}</span></span>`,
    `<span>${PEOPLE}<span><b>${members.length}</b> ${members.length === 1 ? 'member' : 'members'}</span></span>`,
  ].join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Fair split</title>
<style>${CSS}</style>
</head>
<body>
<div class="card">
  <div class="glow"></div>
  <div class="top">
    <div class="brand">${dots('dots')}<span class="brand-name">Groupie</span></div>
    <span class="badge">${CHECK('#A6E35A', 20)}Fair split</span>
  </div>
  <h1 class="title${data.assignmentTitle.length > 42 ? ' long' : ''}">${escapeHtml(data.assignmentTitle)}</h1>
  <div class="meta">${meta}</div>
  <div class="rows">
${rows}
  </div>
  <div class="foot">
    <span class="gap"><span class="ok">${CHECK('#A6E35A', 18)}</span><span>Max difference: <b>${pts(data.maxGap)}</b></span></span>
    <span class="by">${dots('mini')}<span>Split by <b>${escapeHtml(data.nickname)}</b></span></span>
  </div>
</div>
</body>
</html>`;
}
