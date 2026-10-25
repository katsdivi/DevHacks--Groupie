import type { RequestHandler } from 'express';
import { GO_CUBBIE_MAX_TEXT } from '@groupie/shared';
import { env } from '../env.ts';

/**
 * GET /go/cubbie?text=...: a tiny self-contained page that opens Messages to Cubbie with the text filled in.
 * Telegram buttons cannot open sms: links, so they open this page instead. Works without JS (the link and
 * the selectable text), and without CUBBIE_HANDLE (text and Copy only).
 */

/** Lines on the page (kept here, not in copy.ts). */
export const GO_COPY = {
  title: 'Text Cubbie',
  open: 'Open in iMessage',
  copy: 'Copy',
  copied: 'Copied',
  noHandle: 'Open Messages and send this to Cubbie.',
  withHandle: 'Tap Open in iMessage, then send. Or copy it and paste it in your chat with Cubbie.',
  empty: 'Nothing to send yet. Go back to Groupie and tap the button again.',
} as const;

/** Phone numbers, emails and Apple IDs. Anything else is treated as unset. */
const HANDLE = /^[+0-9A-Za-z@._-]{3,100}$/;

/** The handle if it is safe to put in an sms: link, else ''. */
export function safeHandle(raw: string): string {
  let h = raw.trim();
  // A phone number typed with spaces, dashes or brackets: keep the + and the digits.
  if (/^\+?[\d\s().-]+$/.test(h)) h = h.replace(/[\s().-]/g, '');
  if (HANDLE.test(h)) return h;
  if (h && !warned) {
    warned = true;
    console.warn('[go] CUBBIE_HANDLE is set but is not a phone number or Apple ID; the page shows Copy only');
  }
  return '';
}
let warned = false;

/** The `text` query value: a string only (arrays and objects become ''), capped at 500 characters. */
export function goText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return Array.from(value).slice(0, GO_CUBBIE_MAX_TEXT).join('');
}

/**
 * The iOS form `sms:<handle>&body=<text>` (iOS 8+ reads `&body=`; `?body=` is the Android form and older iOS
 * ignored it). Text is percent-encoded with encodeURIComponent, so spaces are %20, not +.
 */
export const smsLink = (handle: string, text: string) => `sms:${handle}&body=${encodeURIComponent(text)}`;

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPES[c]!);

/** The whole page. `text` is already capped; everything reflected is escaped. */
export function renderGoPage(text: string, handle: string): string {
  const t = escapeHtml(text);
  const href = handle && text ? escapeHtml(smsLink(handle, text)) : '';
  const C = GO_COPY;
  const open = href ? `<a id="open" class="btn primary" href="${href}">${C.open}</a>` : '';
  const hint = !text ? C.empty : href ? C.withHandle : C.noHandle;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<meta name="color-scheme" content="dark">
<title>${C.title}</title>
<style>
:root { --ink: #1e1e1e; --panel: #262626; --line: #3a3a3a; --muted: #9a9a9a; --text: #f5f5f5; --cyan: #4fd8e8; --lime: #a6e35a; }
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--ink); color: var(--text); }
body { font: 16px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 28px 16px 40px; min-height: 100vh; }
main { max-width: 440px; margin: 0 auto; }
h1 { font-size: 24px; margin: 0 0 6px; letter-spacing: -0.01em; }
p { color: var(--muted); margin: 0 0 20px; font-size: 15px; }
.box { width: 100%; min-height: 96px; background: var(--panel); color: var(--text); border: 1px dashed var(--line); border-radius: 16px; padding: 14px 16px; font: 600 16px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; word-break: break-word; user-select: all; -webkit-user-select: all; resize: none; }
.btn { display: block; width: 100%; margin-top: 14px; padding: 17px 20px; border-radius: 999px; border: 0; font-family: inherit; font-weight: 700; font-size: 18px; line-height: 1; text-align: center; text-decoration: none; color: #1e1e1e; background: var(--cyan); cursor: pointer; -webkit-tap-highlight-color: transparent; }
.btn:active { transform: scale(0.98); }
.primary { background: var(--lime); font-size: 19px; padding: 20px; margin-top: 0; margin-bottom: 18px; }
.copied { background: var(--lime); }
</style>
</head>
<body>
<main>
<h1>${C.title}</h1>
<p>${hint}</p>
${open}
<textarea id="text" class="box" readonly rows="4" aria-label="Message for Cubbie">${t}</textarea>
${text ? `<button id="copy" class="btn" type="button">${C.copy}</button>` : ''}
</main>
<script>
(function () {
  var box = document.getElementById('text');
  var btn = document.getElementById('copy');
  function done() { if (!btn) return; btn.textContent = '${C.copied}'; btn.className = 'btn copied'; setTimeout(function () { btn.textContent = '${C.copy}'; btn.className = 'btn'; }, 2200); }
  function fallback() { box.removeAttribute('readonly'); box.focus(); box.select(); box.setSelectionRange(0, box.value.length); try { document.execCommand('copy'); done(); } catch (e) {} box.setAttribute('readonly', ''); }
  if (btn) btn.addEventListener('click', function () {
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(box.value).then(done, fallback);
    else fallback();
  });
  var open = document.getElementById('open');
  if (open && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) setTimeout(function () { window.location.href = open.getAttribute('href'); }, 400);
})();
</script>
</body>
</html>`;
}

/**
 * The route. No CSP or X-Frame-Options on purpose: Telegram's in-app browser (and its webview) must be able
 * to load it, and the page has no external assets. Only `text` is read; nothing else is reflected.
 */
export const goCubbiePage: RequestHandler = (req, res) => {
  const text = goText(req.query.text);
  res
    .status(200)
    .set({ 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' })
    .type('html')
    .send(renderGoPage(text, safeHandle(env.cubbieHandle)));
};
