// Generates the animated README SVGs (hero, how-it-works, split card, divider).
// Usage from the repo root: node assets/readme/generate.mjs assets/readme
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = globalThis.process.argv[2];
const FONT = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Roboto, 'Helvetica Neue', Helvetica, Arial, sans-serif`;
const MEMBER = ['#FF6B5B', '#FFB547', '#A6E35A', '#4FD8E8', '#A88BFF', '#FF7AC6'];

const THEMES = {
  dark: {
    bgA: '#1E1E1E', bgB: '#141414', card: '#262626', cardStroke: '#3A3A3A', dash: '#4A4A4A',
    text: '#F5F5F5', muted: '#9A9A9A', faint: '#555555', accent: '#7FA8F0', accentDeep: '#508ADD',
    center: '#F5F5F5', bubble: '#2E2E2E', bubbleMe: '#3A6FD8', bubbleMeText: '#FFFFFF', spark: '#7FA8F0', glow: 'rgba(168,139,255,0.10)',
  },
  light: {
    bgA: '#C4D2E6', bgB: '#ECECEF', card: '#FFFFFF', cardStroke: '#D3DAE6', dash: '#AEB9CB',
    text: '#17213A', muted: '#55607A', faint: '#B6BFCE', accent: '#3A6FD8', accentDeep: '#2F64C8',
    center: '#17213A', bubble: '#FFFFFF', bubbleMe: '#3A6FD8', bubbleMeText: '#FFFFFF', spark: '#3A6FD8', glow: 'rgba(80,138,221,0.16)',
  },
};

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const sparkle = (x, y, s, color, begin, dur = 3.2) =>
  `<path d="M${x} ${y - s} Q${x + s * 0.18} ${y - s * 0.18} ${x + s} ${y} Q${x + s * 0.18} ${y + s * 0.18} ${x} ${y + s} Q${x - s * 0.18} ${y + s * 0.18} ${x - s} ${y} Q${x - s * 0.18} ${y - s * 0.18} ${x} ${y - s}Z" fill="${color}" opacity="0.2"><animate attributeName="opacity" values="0.15;0.85;0.15" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/></path>`;

// Entrance: fade + rise, frozen.
const enter = (begin, dy = 14, dur = 0.7) =>
  `<animate attributeName="opacity" from="0" to="1" dur="${dur}s" begin="${begin}s" fill="freeze"/>` +
  `<animateTransform attributeName="transform" type="translate" from="0 ${dy}" to="0 0" dur="${dur}s" begin="${begin}s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.2 0.8 0.2 1"/>`;

function orbitLogo(cx, cy, r, t, spin = 30) {
  const dots = MEMBER.map((c, i) => {
    const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
    return `<circle cx="${(cx + Math.cos(a) * r * 0.58).toFixed(1)}" cy="${(cy + Math.sin(a) * r * 0.58).toFixed(1)}" r="${(r * 0.15).toFixed(1)}" fill="${c}"/>`;
  }).join('');
  return `<g>
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="${t.card}" stroke="${t.dash}" stroke-width="2" stroke-dasharray="7 7"><animateTransform attributeName="transform" type="rotate" from="0 ${cx} ${cy}" to="-360 ${cx} ${cy}" dur="${spin * 2}s" repeatCount="indefinite"/></circle>
  <g>${dots}<animateTransform attributeName="transform" type="rotate" from="0 ${cx} ${cy}" to="360 ${cx} ${cy}" dur="${spin}s" repeatCount="indefinite"/></g>
  <circle cx="${cx}" cy="${cy}" r="${(r * 0.17).toFixed(1)}" fill="${t.center}"><animate attributeName="r" values="${(r * 0.15).toFixed(1)};${(r * 0.2).toFixed(1)};${(r * 0.15).toFixed(1)}" dur="2.6s" repeatCount="indefinite"/></circle>
</g>`;
}

function frame(w, h, t, id) {
  return `<defs>
  <linearGradient id="${id}bg" x1="0" y1="0" x2="0.35" y2="1"><stop offset="0" stop-color="${t.bgA}"/><stop offset="1" stop-color="${t.bgB}"/></linearGradient>
  <radialGradient id="${id}glow" cx="0.85" cy="0.1" r="0.6"><stop offset="0" stop-color="${t.glow}"/><stop offset="1" stop-color="${t.glow}" stop-opacity="0"/></radialGradient>
</defs>
<rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="24" fill="url(#${id}bg)"/>
<rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="24" fill="url(#${id}glow)"/>
<rect x="1.5" y="1.5" width="${w - 3}" height="${h - 3}" rx="23.5" fill="none" stroke="${t.dash}" stroke-width="1.5" stroke-dasharray="6 6"/>`;
}

// ---------------- HERO ----------------
function hero(name) {
  const t = THEMES[name];
  const W = 1200, H = 440;
  const pills = ['Fair split', 'Availability', 'Meetings', 'Check-ins', 'Canvas via Cubbie'];
  const pw = pills.map((p) => Math.round(p.length * 8.2 + 34));
  let px = 72;
  const pillXs = pw.map((w) => { const x = px; px += w + 10; return x; });
  const cycle = 10;
  const pillsSvg = pills.map((p, i) => {
    const kt = [0, i / 5, (i + 0.02) / 5, (i + 0.98) / 5, (i + 1) / 5, 1].map((v) => Math.min(1, v).toFixed(3));
    const on = `values="0;0;1;1;0;0" keyTimes="${kt.join(';')}"`;
    return `<g opacity="0">${enter(0.9 + i * 0.12, 8, 0.5)}
    <rect x="${pillXs[i]}" y="358" width="${pw[i]}" height="34" rx="17" fill="${t.card}" stroke="${t.cardStroke}" stroke-width="1.2"/>
    <rect x="${pillXs[i]}" y="358" width="${pw[i]}" height="34" rx="17" fill="${t.accentDeep}" opacity="0"><animate attributeName="opacity" ${on} dur="${cycle}s" begin="1.6s" repeatCount="indefinite"/></rect>
    <text x="${pillXs[i] + pw[i] / 2}" y="380" text-anchor="middle" font-size="14" font-weight="600" fill="${t.text}">${esc(p)}</text>
    <text x="${pillXs[i] + pw[i] / 2}" y="380" text-anchor="middle" font-size="14" font-weight="600" fill="#FFFFFF" opacity="0">${esc(p)}<animate attributeName="opacity" ${on} dur="${cycle}s" begin="1.6s" repeatCount="indefinite"/></text>
  </g>`;
  }).join('\n');

  // Group chat panel on the right.
  const PX = 790, PY = 48, PW = 360, PH = 344;
  const msgs = [
    { who: 'Leo', c: MEMBER[1], text: "who's doing the slides?" },
    { who: 'Priya', c: MEMBER[2], text: 'when are we meeting??' },
    { who: 'Jordan', c: MEMBER[3], text: 'I did more work than all of you' },
    { me: true, text: 'Fair split posted. Max difference: 1 pt' },
    { me: true, text: 'Best time: Sun 4 to 5 PM. Invite sent.' },
  ];
  const loop = 12;
  let y = PY + 62;
  const bubbles = msgs.map((m, i) => {
    const start = 1.2 + i * 0.9;
    const k0 = (start / loop).toFixed(3), k1 = ((start + 0.35) / loop).toFixed(3);
    const anim = `<animate attributeName="opacity" values="0;0;1;1;0" keyTimes="0;${k0};${k1};0.94;1" dur="${loop}s" repeatCount="indefinite"/>`;
    let g;
    if (m.me) {
      const bw = Math.round(m.text.length * 7.3 + 30);
      const bx = PX + PW - 16 - bw;
      g = `<g opacity="0">${anim}<rect x="${bx}" y="${y}" width="${bw}" height="38" rx="14" fill="${t.bubbleMe}"/><text x="${bx + 15}" y="${y + 24}" font-size="13.5" font-weight="600" fill="${t.bubbleMeText}">${esc(m.text)}</text></g>`;
      y += 48;
    } else {
      const bw = Math.round(m.text.length * 7.3 + 30);
      g = `<g opacity="0">${anim}<circle cx="${PX + 30}" cy="${y + 34}" r="12" fill="${m.c}"/><text x="${PX + 30}" y="${y + 39}" text-anchor="middle" font-size="12" font-weight="800" fill="#1E1E1E">${m.who[0]}</text><rect x="${PX + 50}" y="${y}" width="${bw}" height="50" rx="14" fill="${t.bubble}" stroke="${t.cardStroke}" stroke-width="1"/><text x="${PX + 65}" y="${y + 20}" font-size="12" font-weight="700" fill="${m.c === MEMBER[2] && name === 'light' ? '#5E9B1E' : m.c === MEMBER[1] && name === 'light' ? '#D98A12' : m.c === MEMBER[3] && name === 'light' ? '#1B9FB0' : m.c}">${m.who}</text><text x="${PX + 65}" y="${y + 39}" font-size="13.5" fill="${t.text}">${esc(m.text)}</text></g>`;
      y += 58;
    }
    return g;
  }).join('\n');

  const body = `
${frame(W, H, t, 'h')}
${sparkle(720, 70, 11, t.spark, 0)}${sparkle(1170, 420, 8, t.spark, 1.1)}${sparkle(640, 330, 7, t.spark, 2.2)}${sparkle(48, 400, 7, t.spark, 0.6)}${sparkle(760, 250, 6, t.spark, 1.7)}
<g opacity="0">${enter(0.1, 10)}${orbitLogo(140, 150, 64, t)}</g>
<g opacity="0">${enter(0.25)}<text x="230" y="182" font-size="92" font-weight="800" letter-spacing="-3" fill="${t.text}">Groupie</text></g>
<g opacity="0">${enter(0.45)}<text x="72" y="268" font-size="30" font-weight="700" letter-spacing="-0.6" fill="${t.text}">Your group project's <tspan fill="${t.accent}">biggest fan.</tspan></text></g>
<g opacity="0">${enter(0.6)}<text x="72" y="306" font-size="17" fill="${t.muted}">A Telegram bot and Mini App that splits group work fairly,</text><text x="72" y="329" font-size="17" fill="${t.muted}">finds the meeting time, and nudges everyone before deadlines.</text></g>
${pillsSvg}
<g opacity="0">${enter(0.5, 18, 0.8)}
  <rect x="${PX}" y="${PY}" width="${PW}" height="${PH}" rx="20" fill="${t.card}" fill-opacity="${name === 'light' ? 0.55 : 0.6}" stroke="${t.dash}" stroke-width="1.5" stroke-dasharray="5 5"/>
  <circle cx="${PX + 24}" cy="${PY + 26}" r="4" fill="${MEMBER[0]}"/><circle cx="${PX + 36}" cy="${PY + 26}" r="4" fill="${MEMBER[1]}"/><circle cx="${PX + 48}" cy="${PY + 26}" r="4" fill="${MEMBER[2]}"/>
  <text x="${PX + 62}" y="${PY + 31}" font-size="14" font-weight="700" fill="${t.text}">Project group</text>
  <text x="${PX + PW - 18}" y="${PY + 31}" text-anchor="end" font-size="12" fill="${t.muted}">4 members</text>
  <line x1="${PX + 16}" y1="${PY + 46}" x2="${PX + PW - 16}" y2="${PY + 46}" stroke="${t.cardStroke}" stroke-dasharray="4 4"/>
</g>
${bubbles}`;
  return svg(W, H, 'Groupie: your group project\'s biggest fan', body);
}

// ---------------- FLOW ----------------
function cubicLen(p0, p1, p2, p3) {
  let len = 0, prev = p0;
  for (let i = 1; i <= 400; i++) {
    const s = i / 400, u = 1 - s;
    const pt = [0, 1].map((k) => u * u * u * p0[k] + 3 * u * u * s * p1[k] + 3 * u * s * s * p2[k] + s * s * s * p3[k]);
    len += Math.hypot(pt[0] - prev[0], pt[1] - prev[1]);
    prev = pt;
  }
  return len;
}

function icon(kind, x, y, c) {
  const s = `fill="none" stroke="${c}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"`;
  switch (kind) {
    case 'doc': return `<g ${s}><path d="M${x} ${y}h16l8 8v22h-24z"/><path d="M${x + 16} ${y}v8h8"/><path d="M${x + 5} ${y + 16}h14M${x + 5} ${y + 22}h10"/></g>`;
    case 'list': return `<g ${s}><path d="M${x + 9} ${y + 4}h17M${x + 9} ${y + 15}h17M${x + 9} ${y + 26}h11"/><circle cx="${x + 2}" cy="${y + 4}" r="1.6"/><circle cx="${x + 2}" cy="${y + 15}" r="1.6"/><circle cx="${x + 2}" cy="${y + 26}" r="1.6"/></g>`;
    case 'bars': return `<g ${s}><path d="M${x} ${y + 4}h26M${x} ${y + 13}h26M${x} ${y + 22}h26"/><path d="M${x} ${y + 31}h26" stroke-dasharray="3 3"/></g>`;
    case 'grid': return `<g ${s}><rect x="${x}" y="${y}" width="28" height="28" rx="4"/><path d="M${x + 9.3} ${y}v28M${x + 18.6} ${y}v28M${x} ${y + 9.3}h28M${x} ${y + 18.6}h28"/></g>`;
    case 'poll': return `<g ${s}><path d="M${x} ${y + 30}h28"/><path d="M${x + 4} ${y + 30}v-12M${x + 14} ${y + 30}v-24M${x + 24} ${y + 30}v-17"/></g>`;
    case 'cal': return `<g ${s}><rect x="${x}" y="${y + 3}" width="28" height="26" rx="4"/><path d="M${x} ${y + 11}h28M${x + 7} ${y}v6M${x + 21} ${y}v6"/><path d="M${x + 8} ${y + 20}l4 4 8-8"/></g>`;
    case 'bell': return `<g ${s}><path d="M${x + 4} ${y + 22}c0-3 2-4 2-9a8 8 0 0 1 16 0c0 5 2 6 2 9z"/><path d="M${x + 11} ${y + 26}a3 3 0 0 0 6 0"/></g>`;
  }
}

function flow(name) {
  const t = THEMES[name];
  const W = 1200, H = 570;
  const CW = 250, CH = 196;
  const tops = [55, 335, 615, 895].map((x) => ({ x, y: 84 }));
  const bots = [895, 615, 335].map((x) => ({ x, y: 330 }));
  const cards = [...tops, ...bots];
  const steps = [
    { icon: 'doc', title: 'Drop the assignment', lines: ['PDF, Word, slides and more,', 'or pull it from Canvas', 'through Cubbie with /canvas.'] },
    { icon: 'list', title: 'Tasks with points', lines: ['The LLM reads it into 6 to 14', 'tasks with effort points', 'and skill tags.'] },
    { icon: 'bars', title: 'Fair split card', lines: ['Code, not the LLM, balances', 'the points. Swap any time,', 'then vote Looks fair.'] },
    { icon: 'grid', title: 'Availability', lines: ['Paint a 7 day grid, or let', 'your calendar prefill it.', 'Busy times only, never titles.'] },
    { icon: 'poll', title: 'Poll', lines: ['The 3 best one hour slots,', 'then how to meet: Meet,', 'Zoom or in person.'] },
    { icon: 'cal', title: 'Meeting', lines: ['Meeting card, .ics file and', 'DMs, plus a Google Calendar', 'invite when keys are set.'] },
    { icon: 'bell', title: 'Nudges', lines: ['Monday check-ins, a progress', 'card, and DM reminders', '48, 24 and 3 hours out.'] },
  ];
  // Path through card centers (snake).
  const cy1 = 84 + CH + 22, cy2 = 330 + CH + 22;
  const cx = (i) => cards[i].x + CW / 2;
  const path = `M${cx(0)} ${cy1} H${cx(3)} C${cx(3) + 215} ${cy1} ${cx(3) + 215} ${cy2} ${cx(3)} ${cy2} H${cx(6)}`;
  const top = cx(3) - cx(0);
  const curve = cubicLen([cx(3), cy1], [cx(3) + 215, cy1], [cx(3) + 215, cy2], [cx(3), cy2]);
  const total = top + curve + (cx(3) - cx(6));
  const arrive = [0, 280, 560, 840, 840 + curve, 840 + curve + 280, 840 + curve + 560].map((d) => d / total);
  const LOOP = 10.5, travel = 0.86; // the dot spends 86% of the loop travelling, then rests
  const tAt = (f) => f * travel;
  const colors = [MEMBER[0], MEMBER[1], MEMBER[2], MEMBER[3], MEMBER[4], MEMBER[5], t.accentDeep];

  const cardSvg = steps.map((s, i) => {
    const { x, y } = cards[i];
    const ta = tAt(arrive[i]);
    const k = (v) => Math.max(0, Math.min(1, v)).toFixed(4);
    const hl = `values="0;0;1;0.35;0.35;0" keyTimes="0;${k(ta - 0.012)};${k(ta + 0.01)};${k(ta + 0.08)};0.97;1"`;
    return `<g opacity="0">${enter(0.15 + i * 0.12, 12, 0.6)}
  <rect x="${x}" y="${y}" width="${CW}" height="${CH}" rx="18" fill="${t.card}" stroke="${t.cardStroke}" stroke-width="1.5"/>
  <rect x="${x}" y="${y}" width="${CW}" height="${CH}" rx="18" fill="none" stroke="${colors[i]}" stroke-width="2.5" opacity="0"><animate attributeName="opacity" ${hl} dur="${LOOP}s" begin="1.2s" repeatCount="indefinite"/></rect>
  <circle cx="${x + 34}" cy="${y + 36}" r="16" fill="${colors[i]}"/>
  <text x="${x + 34}" y="${y + 42}" text-anchor="middle" font-size="16" font-weight="800" fill="#1E1E1E">${i + 1}</text>
  ${icon(s.icon, x + CW - 50, y + 20, t.muted)}
  <text x="${x + 20}" y="${y + 92}" font-size="19" font-weight="750" letter-spacing="-0.3" fill="${t.text}">${esc(s.title)}</text>
  ${s.lines.map((l, j) => `<text x="${x + 20}" y="${y + 122 + j * 21}" font-size="13.5" fill="${t.muted}">${esc(l)}</text>`).join('')}
</g>`;
  }).join('\n');

  const motionKT = `0;${travel};1`;
  const body = `
${frame(W, H, t, 'f')}
${sparkle(1170, 40, 8, t.spark, 0.4)}${sparkle(300, 545, 7, t.spark, 1.5)}
<text x="56" y="56" font-size="13" font-weight="800" letter-spacing="2.4" fill="${t.accent}">HOW IT WORKS</text>
<text x="1144" y="56" text-anchor="end" font-size="13" fill="${t.muted}">one group chat, start to finish</text>
<path d="${path}" fill="none" stroke="${t.dash}" stroke-width="2.5" stroke-dasharray="8 8"><animate attributeName="stroke-dashoffset" from="0" to="-32" dur="1.2s" repeatCount="indefinite"/></path>
${cards.map((c, i) => `<line x1="${cx(i)}" y1="${c.y + CH}" x2="${cx(i)}" y2="${i < 4 ? cy1 : cy2}" stroke="${t.dash}" stroke-width="2" stroke-dasharray="3 3"/><circle cx="${cx(i)}" cy="${i < 4 ? cy1 : cy2}" r="5" fill="${colors[i]}"/>`).join('')}
${cardSvg}
<g opacity="0">${enter(1.1)}
  <text x="56" y="388" font-size="26" font-weight="800" letter-spacing="-0.6" fill="${t.text}">One assignment in,</text>
  <text x="56" y="420" font-size="26" font-weight="800" letter-spacing="-0.6" fill="${t.accent}">one meeting out.</text>
  <text x="56" y="458" font-size="14" fill="${t.muted}">Everything happens in your</text>
  <text x="56" y="479" font-size="14" fill="${t.muted}">Telegram group and the</text>
  <text x="56" y="500" font-size="14" fill="${t.muted}">Groupie Mini App.</text>
</g>
<g opacity="0"><animate attributeName="opacity" from="0" to="1" dur="0.3s" begin="1.2s" fill="freeze"/>
  <circle r="14" fill="${t.accentDeep}" opacity="0.25"><animate attributeName="r" values="10;18;10" dur="1.2s" repeatCount="indefinite"/></circle>
  <circle r="7" fill="${t.accentDeep}" stroke="#FFFFFF" stroke-width="2"/>
  <animateMotion dur="${LOOP}s" begin="1.2s" repeatCount="indefinite" path="${path}" keyPoints="0;1;1" keyTimes="${motionKT}" calcMode="linear"/>
</g>`;
  return svg(W, H, 'How Groupie works, in seven steps', body);
}

// ---------------- SPLIT CARD ----------------
function splitCard() {
  const W = 1000, H = 740;
  const members = [
    { name: 'Maya', c: MEMBER[0], tasks: [['Problem statement', 4], ['Team charter', 5]] },
    { name: 'Leo', c: MEMBER[1], tasks: [['Competitive scan', 5], ['Rank features', 4]] },
    { name: 'Priya', c: MEMBER[2], tasks: [['Research plan', 4], ['Interview questions', 5]] },
    { name: 'Jordan', c: MEMBER[3], tasks: [['Tech plan', 5], ['Integrate and proofread', 4]] },
  ];
  const dots = MEMBER.map((c, i) => `<circle cx="${70 + (i % 3) * 15}" cy="${62 + Math.floor(i / 3) * 15}" r="5" fill="${c}"/>`).join('');
  let rows = '';
  members.forEach((m, i) => {
    const y = 236 + i * 86;
    const b = 1.0 + i * 0.25;
    let tx = 250;
    const pills = m.tasks.map(([title, pts], j) => {
      const w = Math.round(title.length * 7.6 + 62);
      const s = `<g opacity="0"><animate attributeName="opacity" from="0" to="1" dur="0.4s" begin="${b + 0.2 + j * 0.12}s" fill="freeze"/>
        <rect x="${tx}" y="${y + 14}" width="${w}" height="32" rx="10" fill="#2A2A2A" stroke="#3A3A3A"/>
        <text x="${tx + 13}" y="${y + 35}" font-size="14.5" font-weight="550" fill="#F5F5F5">${esc(title)}</text>
        <text x="${tx + w - 12}" y="${y + 35}" text-anchor="end" font-size="13" font-weight="700" fill="${m.c}">${pts}</text></g>`;
      tx += w + 10;
      return s;
    }).join('');
    rows += `<g opacity="0">${enter(b, 10, 0.5)}
      <rect x="64" y="${y + 8}" width="44" height="44" rx="14" fill="${m.c}"/>
      <text x="86" y="${y + 37}" text-anchor="middle" font-size="20" font-weight="800" fill="#1E1E1E">${m.name[0]}</text>
      <text x="124" y="${y + 37}" font-size="21" font-weight="650" fill="#F5F5F5">${m.name}</text>
    </g>
    ${pills}
    <g opacity="0"><animate attributeName="opacity" from="0" to="1" dur="0.4s" begin="${b + 0.3}s" fill="freeze"/>
      <text x="936" y="${y + 30}" text-anchor="end" font-size="22" font-weight="800" fill="#F5F5F5">9 <tspan font-size="15" fill="#9A9A9A" font-weight="600">pts</tspan></text>
      <rect x="826" y="${y + 42}" width="110" height="6" rx="3" fill="#333"/>
      <rect x="826" y="${y + 42}" width="0" height="6" rx="3" fill="${m.c}"><animate attributeName="width" from="0" to="110" dur="0.9s" begin="${b + 0.35}s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.2 0.8 0.2 1"/></rect>
    </g>
    <line x1="64" y1="${y + 70}" x2="936" y2="${y + 70}" stroke="#3A3A3A" stroke-width="2" stroke-dasharray="6 6"/>`;
  });
  const voteBegin = 3.0;
  const votes = [0, 1, 2, 3, 4].map((n) => {
    const on = voteBegin + n * 0.45, off = voteBegin + (n + 1) * 0.45;
    const anim = n === 4
      ? `<animate attributeName="opacity" from="0" to="1" dur="0.01s" begin="${on}s" fill="freeze"/>`
      : `<set attributeName="opacity" to="1" begin="${on}s"/><set attributeName="opacity" to="0" begin="${off}s"/>`;
    return `<text x="290" y="${H - 42}" text-anchor="middle" font-size="16" font-weight="700" fill="#F5F5F5" opacity="0">Looks fair (${n}/4)${anim}</text>`;
  }).join('');
  const body = `<defs><radialGradient id="sg" cx="1" cy="0" r="0.7"><stop offset="0" stop-color="rgba(168,139,255,0.10)"/><stop offset="1" stop-color="rgba(168,139,255,0)"/></radialGradient></defs>
<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="26" fill="#141414"/>
<rect x="24" y="24" width="${W - 48}" height="${H - 120}" rx="22" fill="#1E1E1E" stroke="#4A4A4A" stroke-width="2" stroke-dasharray="7 6"/>
<rect x="24" y="24" width="${W - 48}" height="${H - 120}" rx="22" fill="url(#sg)"/>
<g opacity="0">${enter(0.1, 8)}${dots}<text x="122" y="76" font-size="21" font-weight="750" letter-spacing="-0.4" fill="#F5F5F5">Groupie</text>
  <rect x="790" y="48" width="146" height="40" rx="20" fill="rgba(255,255,255,0.03)" stroke="#555" stroke-width="1.5" stroke-dasharray="4 4"/>
  <circle cx="815" cy="68" r="10" fill="#A6E35A"><animate attributeName="r" values="10;12;10" dur="2s" begin="3s" repeatCount="indefinite"/></circle>
  <path d="M810 68l3.5 3.5 6.5-7" fill="none" stroke="#1E1E1E" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="834" y="74" font-size="16" font-weight="650" fill="#F5F5F5">Fair split</text></g>
<g opacity="0">${enter(0.3)}<text x="64" y="156" font-size="44" font-weight="800" letter-spacing="-1.4" fill="#F5F5F5">Project Proposal</text></g>
<g opacity="0">${enter(0.45)}<text x="64" y="194" font-size="17" font-weight="500" fill="#9A9A9A">Due <tspan fill="#F5F5F5" font-weight="650">Wed, Oct 28</tspan>  ·  <tspan fill="#F5F5F5" font-weight="650">8</tspan> tasks  ·  <tspan fill="#F5F5F5" font-weight="650">36</tspan> points  ·  <tspan fill="#F5F5F5" font-weight="650">4</tspan> members</text></g>
<line x1="64" y1="226" x2="936" y2="226" stroke="#3A3A3A" stroke-width="2" stroke-dasharray="6 6"/>
${rows}
<g opacity="0"><animate attributeName="opacity" from="0" to="1" dur="0.5s" begin="2.4s" fill="freeze"/>
  <text x="64" y="${H - 132}" font-size="16" font-weight="600" fill="#9A9A9A">Max difference: <tspan fill="#A6E35A" font-weight="800">0 pt</tspan></text>
  <text x="936" y="${H - 132}" text-anchor="end" font-size="16" fill="#9A9A9A">Split by Motu</text>
</g>
<g opacity="0"><animate attributeName="opacity" from="0" to="1" dur="0.4s" begin="2.7s" fill="freeze"/>
  <rect x="64" y="${H - 72}" width="452" height="46" rx="12" fill="#2B5278"/>
  <rect x="528" y="${H - 72}" width="408" height="46" rx="12" fill="#2B5278"/>
  <text x="732" y="${H - 42}" text-anchor="middle" font-size="16" font-weight="700" fill="#F5F5F5">Request swap</text>
</g>
${votes}`;
  return svg(W, H, 'An animated Groupie fair split card', body);
}

// ---------------- DIVIDER ----------------
function divider() {
  const W = 1200, H = 28;
  const dots = MEMBER.map((c, i) => {
    const x = 600 + (i - 2.5) * 18;
    return `<circle cx="${x}" cy="14" r="4.5" fill="${c}"><animate attributeName="r" values="4.5;6.5;4.5" dur="2.4s" begin="${(i * 0.2).toFixed(1)}s" repeatCount="indefinite"/></circle>`;
  }).join('');
  const body = `<line x1="40" y1="14" x2="530" y2="14" stroke="#8B949E" stroke-opacity="0.75" stroke-width="1.5" stroke-dasharray="6 6"><animate attributeName="stroke-dashoffset" from="0" to="24" dur="1.6s" repeatCount="indefinite"/></line>
<line x1="670" y1="14" x2="1160" y2="14" stroke="#8B949E" stroke-opacity="0.75" stroke-width="1.5" stroke-dasharray="6 6"><animate attributeName="stroke-dashoffset" from="0" to="-24" dur="1.6s" repeatCount="indefinite"/></line>
${dots}`;
  return svg(W, H, 'Section divider', body);
}

function svg(w, h, title, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}" font-family="${FONT}">
<title>${esc(title)}</title>
${body}
</svg>
`;
}

const files = {
  'hero-dark.svg': hero('dark'),
  'hero-light.svg': hero('light'),
  'how-it-works-dark.svg': flow('dark'),
  'how-it-works-light.svg': flow('light'),
  'split-card.svg': splitCard(),
  'divider.svg': divider(),
};
for (const [n, s] of Object.entries(files)) {
  writeFileSync(join(OUT, n), s.replace(/\n\s*\n/g, '\n'));
  globalThis.console.log(n, s.length);
}
