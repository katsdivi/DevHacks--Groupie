import { readFileSync } from 'node:fs';
import { BRAND_COLORS, escapeHtml } from './splitCard.ts';

export type ProgressCardData = {
  assignmentTitle: string;
  dueLabel: string | null; // e.g. "Fri, Nov 20"
  daysLeft: number | null; // negative = overdue, 0 = due today
  nickname: string; // footer "Tracked by <nickname>"
  percent: number; // overall 0 to 100 (by points)
  donePoints: number;
  totalPoints: number;
  members: {
    name: string;
    color: string; // member hex accent
    percent: number; // 0 to 100 of their points done
    donePoints: number;
    points: number;
    tasks: { title: string; effort: number; status: 'todo' | 'on_track' | 'stuck' | 'done' }[];
  }[];
};

type Status = ProgressCardData['members'][number]['tasks'][number]['status'];

const LIME = '#A6E35A';
const CYAN = '#4FD8E8';
const CORAL = '#FF6B5B';
const AMBER = '#FFB547';

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

/** Only allow plain hex colors into CSS; anything else falls back to the palette. */
function safeColor(color: string, i: number): string {
  return /^#[0-9a-f]{3,8}$/i.test(color) ? color : BRAND_COLORS[i % BRAND_COLORS.length];
}

const clampPct = (n: number) => (Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : 0);
const num = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

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
    radial-gradient(500px 240px at 100% 0%, rgba(79,216,232,0.06), transparent 70%);
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

.hero {
  margin-top: 34px;
  position: relative;
  display: grid; grid-template-columns: auto 1fr; column-gap: 44px; align-items: center;
  padding: 30px 34px 30px 36px;
  border: 2px dashed #3A3A3A;
  border-radius: 20px;
  background: rgba(255,255,255,0.018);
}
.big { display: flex; align-items: flex-start; line-height: 0.86; font-variant-numeric: tabular-nums; }
.big .v { font-size: 116px; font-weight: 800; letter-spacing: -0.055em; }
.big .pc { font-size: 50px; font-weight: 750; letter-spacing: -0.03em; color: #9A9A9A; margin: 6px 0 0 4px; }
.big-label { margin-top: 14px; font-size: 14px; font-weight: 650; color: #9A9A9A; text-transform: uppercase; letter-spacing: 0.14em; }
.hero-right { min-width: 0; }
.track {
  height: 26px; border-radius: 999px; background: #2A2A2A;
  display: flex; overflow: hidden; gap: 0;
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.03);
}
.track i { display: block; height: 100%; background: var(--c); }
.track i + i { box-shadow: inset 3px 0 0 #1E1E1E; }
.hero-sub { margin-top: 18px; display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.pts { font-size: 21px; color: #9A9A9A; font-weight: 500; }
.pts b { color: #F5F5F5; font-weight: 700; font-variant-numeric: tabular-nums; }
.chip {
  flex: none; display: inline-flex; align-items: center; gap: 8px;
  height: 38px; padding: 0 16px 0 12px; border-radius: 999px;
  font-size: 17px; font-weight: 650;
  color: var(--k);
  background: color-mix(in srgb, var(--k) 13%, transparent);
  border: 1.5px solid color-mix(in srgb, var(--k) 40%, transparent);
}
.chip svg { display: block; }

.legend { margin-top: 26px; display: flex; flex-wrap: wrap; gap: 10px 28px; font-size: 17px; color: #9A9A9A; font-weight: 500; position: relative; }
.legend > span { display: inline-flex; align-items: center; gap: 9px; white-space: nowrap; }
.legend b { margin-left: 2px; }
.legend b { color: #F5F5F5; font-weight: 700; font-variant-numeric: tabular-nums; }
.legend .hot b { color: ${CORAL}; }

.rows { margin-top: 22px; border-top: 2px dashed #3A3A3A; position: relative; }
.row {
  display: grid;
  grid-template-columns: 210px 1fr 112px;
  column-gap: 28px;
  padding: 26px 0 28px;
  border-bottom: 2px dashed #3A3A3A;
}
.who { display: flex; align-items: flex-start; gap: 14px; min-width: 0; align-self: start; padding-top: 3px; }
.avatar {
  flex: none; width: 44px; height: 44px; border-radius: 14px;
  display: grid; place-items: center;
  background: var(--c); color: #1E1E1E;
  font-size: 20px; font-weight: 800;
}
.who-text { min-width: 0; padding-top: 9px; }
.name {
  font-size: 22px; line-height: 1.2; font-weight: 650; letter-spacing: -0.015em;
  overflow-wrap: anywhere;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.help {
  margin-top: 10px;
  display: inline-flex; align-items: center; gap: 6px;
  height: 26px; padding: 0 10px 0 8px; border-radius: 8px;
  font-size: 13px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
  color: ${CORAL};
  background: rgba(255,107,91,0.12);
  border: 1px solid rgba(255,107,91,0.38);
}
.help svg { display: block; }
.work { min-width: 0; }
.pills { display: flex; flex-wrap: wrap; gap: 8px; }
.pill {
  display: inline-flex; align-items: center; gap: 9px;
  max-width: 100%;
  height: 36px; padding: 0 6px 0 9px;
  border-radius: 10px;
  background: #262626;
  border: 1px solid #343434;
  font-size: 16px; font-weight: 500; color: #EDEDED;
}
.s { flex: none; width: 18px; height: 18px; display: block; }
.pill .t { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.pill .p {
  flex: none;
  min-width: 24px; height: 24px; padding: 0 7px;
  border-radius: 7px;
  display: grid; place-items: center;
  background: rgba(255,255,255,0.07);
  color: #BDBDBD;
  font-size: 14px; font-weight: 700;
}
.pill.done { background: #232323; border-color: #2E2E2E; color: #858585; }
.pill.done .t { text-decoration: line-through; text-decoration-color: rgba(166,227,90,0.45); text-decoration-thickness: 2px; }
.pill.done .p { background: rgba(166,227,90,0.12); color: ${LIME}; }
.pill.on_track { background: color-mix(in srgb, ${CYAN} 8%, #262626); border-color: color-mix(in srgb, ${CYAN} 30%, transparent); }
.pill.on_track .p { background: rgba(79,216,232,0.16); color: ${CYAN}; }
.pill.stuck {
  background: color-mix(in srgb, ${CORAL} 16%, #262626);
  border: 1.5px solid color-mix(in srgb, ${CORAL} 75%, transparent);
  color: #FFE1DC; font-weight: 600;
  box-shadow: 0 0 0 3px rgba(255,107,91,0.10), 0 0 22px rgba(255,107,91,0.22);
}
.pill.stuck .p { background: rgba(255,107,91,0.28); color: #FFB3A9; }
.pill.todo { background: transparent; border: 1.5px dashed #4A4A4A; color: #C4C4C4; }
.empty { color: #6A6A6A; font-size: 16px; font-style: italic; height: 36px; display: flex; align-items: center; }
.bar { margin-top: 18px; height: 10px; border-radius: 999px; background: #2A2A2A; overflow: hidden; }
.bar i { display: block; height: 100%; border-radius: 999px; background: var(--c); box-shadow: 0 0 18px color-mix(in srgb, var(--c) 45%, transparent); }
.total { text-align: right; align-self: start; padding-top: 1px; }
.total .n { font-variant-numeric: tabular-nums; font-size: 40px; font-weight: 750; letter-spacing: -0.04em; line-height: 1; white-space: nowrap; }
.total .n small { font-size: 24px; font-weight: 700; color: #9A9A9A; letter-spacing: -0.02em; margin-left: 1px; }
.total .n.full { color: ${LIME}; }
.total .n.full small { color: ${LIME}; opacity: 0.7; }
.total .u { margin-top: 8px; font-size: 14px; font-weight: 600; color: #9A9A9A; text-transform: uppercase; letter-spacing: 0.1em; white-space: nowrap; font-variant-numeric: tabular-nums; }
.foot { margin-top: 30px; display: flex; align-items: center; justify-content: space-between; gap: 20px; font-size: 19px; color: #9A9A9A; font-weight: 500; position: relative; }
.foot .overall { display: inline-flex; align-items: center; gap: 12px; }
.foot .overall b { color: #F5F5F5; font-weight: 650; }
.foot .overall svg { display: block; }
.foot .by { display: inline-flex; align-items: center; gap: 10px; }
.foot .by b { color: #F5F5F5; font-weight: 650; }
.mini { display: inline-flex; gap: 4px; }
.mini i { width: 7px; height: 7px; border-radius: 50%; display: block; }
`;

const dots = (cls: string) =>
  `<span class="${cls}">${BRAND_COLORS.map((c) => `<i style="background:${c}"></i>`).join('')}</span>`;

const CALENDAR = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9A9A9A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>`;

const LIST = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9A9A9A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/></svg>`;

const PEOPLE = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9A9A9A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.8a3.5 3.5 0 0 1 0 6.4M18.5 14.8c1.6.8 2.6 2.5 3 5.2"/></svg>`;

const CLOCK = (color: string) =>
  `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>`;

const ALERT = (color: string, size: number) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5M12 17.6v.1"/></svg>`;

/** Small progress ring; `pct` 0 to 100. */
function ring(pct: number, size: number, stroke: number, color: string): string {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - pct / 100);
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#333" stroke-width="${stroke}"/><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${off.toFixed(2)}" transform="rotate(-90 ${size / 2} ${size / 2})"/></svg>`;
}

/** 18px status icon used in task pills and the legend. */
function statusIcon(status: Status): string {
  switch (status) {
    case 'done':
      return `<svg class="s" viewBox="0 0 18 18"><circle cx="9" cy="9" r="9" fill="${LIME}"/><path d="M5.2 9.3l2.5 2.5 5-5.2" fill="none" stroke="#1E1E1E" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    case 'on_track':
      return `<svg class="s" viewBox="0 0 18 18"><circle cx="9" cy="9" r="8" fill="rgba(79,216,232,0.18)"/><circle cx="9" cy="9" r="4.6" fill="${CYAN}"/></svg>`;
    case 'stuck':
      return `<svg class="s" viewBox="0 0 18 18"><circle cx="9" cy="9" r="9" fill="${CORAL}"/><path d="M9 4.6v5.2" stroke="#1E1E1E" stroke-width="2.3" stroke-linecap="round"/><circle cx="9" cy="13.1" r="1.3" fill="#1E1E1E"/></svg>`;
    case 'todo':
    default:
      return `<svg class="s" viewBox="0 0 18 18"><circle cx="9" cy="9" r="7.6" fill="none" stroke="#6A6A6A" stroke-width="1.8" stroke-dasharray="3 2.6"/></svg>`;
  }
}

function dueChip(daysLeft: number | null): string {
  if (daysLeft === null || !Number.isFinite(daysLeft)) return '';
  const d = Math.round(daysLeft);
  if (d < 0) return `<span class="chip" style="--k:${CORAL}">${ALERT(CORAL, 18)}${plural(-d, 'day', 'days')} overdue</span>`;
  if (d === 0) return `<span class="chip" style="--k:${AMBER}">${CLOCK(AMBER)}Due today</span>`;
  const k = d <= 2 ? AMBER : LIME;
  return `<span class="chip" style="--k:${k}">${CLOCK(k)}${plural(d, 'day', 'days')} left</span>`;
}

export function progressCardHtml(data: ProgressCardData): string {
  const members = data.members.map((m, i) => ({ ...m, color: safeColor(m.color, i) }));
  const percent = clampPct(data.percent);
  const totalPoints = num(data.totalPoints);
  const donePoints = Math.min(num(data.donePoints), totalPoints || num(data.donePoints));
  const allTasks = members.flatMap((m) => m.tasks);
  const count = (s: Status) => allTasks.filter((t) => t.status === s).length;

  // Overall bar: one segment per member, sized by the points they finished.
  const segTotal = Math.max(1, totalPoints, members.reduce((n, m) => n + num(m.donePoints), 0));
  const segments = members
    .filter((m) => num(m.donePoints) > 0)
    .map((m) => `<i style="--c:${m.color};width:${Math.round((num(m.donePoints) / segTotal) * 10000) / 100}%"></i>`)
    .join('');

  const rows = members
    .map((m) => {
      const pct = clampPct(m.percent);
      const initial = escapeHtml(Array.from(m.name.trim())[0]?.toUpperCase() ?? '?');
      const stuck = m.tasks.some((t) => t.status === 'stuck');
      const pills = m.tasks.length
        ? m.tasks
            .map(
              (t) =>
                `<span class="pill ${t.status}">${statusIcon(t.status)}<span class="t">${escapeHtml(t.title)}</span><span class="p">${num(t.effort)}</span></span>`,
            )
            .join('')
        : '<span class="empty">No tasks yet</span>';
      const help = stuck ? `<div><span class="help">${ALERT(CORAL, 13)}Needs help</span></div>` : '';
      return `<div class="row" style="--c:${m.color}">
  <div class="who"><span class="avatar">${initial}</span><div class="who-text"><div class="name">${escapeHtml(m.name)}</div>${help}</div></div>
  <div class="work"><div class="pills">${pills}</div><div class="bar">${pct > 0 ? `<i style="width:${Math.max(2, pct)}%"></i>` : ''}</div></div>
  <div class="total"><div class="n${pct === 100 ? ' full' : ''}">${pct}<small>%</small></div><div class="u">${num(m.donePoints)} of ${num(m.points)} pts</div></div>
</div>`;
    })
    .join('\n');

  const meta = [
    data.dueLabel ? `<span>${CALENDAR}<span>Due <b>${escapeHtml(data.dueLabel)}</b></span></span>` : '',
    `<span>${LIST}<span><b>${allTasks.length}</b> ${allTasks.length === 1 ? 'task' : 'tasks'} · <b>${totalPoints}</b> ${totalPoints === 1 ? 'point' : 'points'}</span></span>`,
    `<span>${PEOPLE}<span><b>${members.length}</b> ${members.length === 1 ? 'member' : 'members'}</span></span>`,
  ].join('');

  const stuckCount = count('stuck');
  const legend = [
    `<span>${statusIcon('done')}Done <b>${count('done')}</b></span>`,
    `<span>${statusIcon('on_track')}On track <b>${count('on_track')}</b></span>`,
    `<span class="${stuckCount ? 'hot' : ''}">${statusIcon('stuck')}Stuck <b>${stuckCount}</b></span>`,
    `<span>${statusIcon('todo')}To do <b>${count('todo')}</b></span>`,
  ].join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Progress</title>
<style>${CSS}</style>
</head>
<body>
<div class="card">
  <div class="glow"></div>
  <div class="top">
    <div class="brand">${dots('dots')}<span class="brand-name">Groupie</span></div>
    <span class="badge">${ring(Math.max(percent, 8), 20, 3.4, CYAN)}Progress</span>
  </div>
  <h1 class="title${data.assignmentTitle.length > 42 ? ' long' : ''}">${escapeHtml(data.assignmentTitle)}</h1>
  <div class="meta">${meta}</div>
  <div class="hero">
    <div><div class="big"><span class="v">${percent}</span><span class="pc">%</span></div><div class="big-label">Overall done</div></div>
    <div class="hero-right">
      <div class="track">${segments}</div>
      <div class="hero-sub"><span class="pts"><b>${donePoints}</b> of <b>${totalPoints}</b> points done</span>${dueChip(data.daysLeft)}</div>
    </div>
  </div>
  <div class="legend">${legend}</div>
  <div class="rows">
${rows}
  </div>
  <div class="foot">
    <span class="overall">${ring(percent, 30, 4.5, LIME)}<span>Overall <b>${percent}% done</b></span></span>
    <span class="by">${dots('mini')}<span>Tracked by <b>${escapeHtml(data.nickname)}</b></span></span>
  </div>
</div>
</body>
</html>`;
}
