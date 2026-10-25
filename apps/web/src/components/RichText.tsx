import type { ReactNode } from 'react';
import { openExternal } from '../telegram.ts';

/**
 * Tiny, safe formatter for assistant replies: paragraphs, line breaks,
 * **bold**, "- " bullet lists, "1. " numbered lists and clickable URLs.
 * Everything renders as React text nodes, never as HTML.
 */

type Block =
  | { kind: 'p'; lines: string[] }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] };

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*\d{1,2}[.)]\s+(.*)$/;

function toBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const last = blocks[blocks.length - 1];
    const b = BULLET.exec(line);
    const n = b ? null : NUMBERED.exec(line);
    if (b) {
      if (last?.kind === 'ul') last.items.push(b[1]);
      else blocks.push({ kind: 'ul', items: [b[1]] });
    } else if (n) {
      if (last?.kind === 'ol') last.items.push(n[1]);
      else blocks.push({ kind: 'ol', items: [n[1]] });
    } else if (!line.trim()) {
      blocks.push({ kind: 'p', lines: [] });
    } else if (last?.kind === 'p') {
      last.lines.push(line);
    } else {
      blocks.push({ kind: 'p', lines: [line] });
    }
  }
  return blocks.filter((b) => (b.kind === 'p' ? b.lines.length > 0 : true));
}

const TOKEN = /(\*\*[^*\n]+\*\*|https?:\/\/[^\s<>()]+[^\s<>().,!?;:'"])/g;

function inline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let i = 0;
  for (const m of text.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    if (at > i) out.push(text.slice(i, at));
    const tok = m[0];
    const key = `${keyPrefix}-${at}`;
    if (tok.startsWith('**')) {
      out.push(
        <strong key={key} className="font-semibold text-text">
          {inline(tok.slice(2, -2), key)}
        </strong>,
      );
    } else {
      out.push(
        <a
          key={key}
          href={tok}
          target="_blank"
          rel="noreferrer noopener"
          onClick={(e) => openExternal(tok, e)}
          className="break-all underline decoration-line-strong underline-offset-2 hover:decoration-text"
        >
          {tok.replace(/^https?:\/\/(www\.)?/, '')}
        </a>,
      );
    }
    i = at + tok.length;
  }
  if (i < text.length) out.push(text.slice(i));
  return out;
}

export function RichText({ text, accent }: { text: string; accent: string }) {
  const blocks = toBlocks(text);
  return (
    <div className="space-y-2">
      {blocks.map((b, bi) => {
        if (b.kind === 'p') {
          return (
            <p key={bi}>
              {b.lines.map((l, li) => (
                <span key={li}>
                  {li > 0 && <br />}
                  {inline(l, `${bi}-${li}`)}
                </span>
              ))}
            </p>
          );
        }
        const Tag = b.kind === 'ul' ? 'ul' : 'ol';
        return (
          <Tag key={bi} className="space-y-1">
            {b.items.map((it, ii) => (
              <li key={ii} className="flex gap-2.5">
                {b.kind === 'ul' ? (
                  <span className="mt-[0.6em] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: accent }} aria-hidden />
                ) : (
                  <span className="min-w-[1.1em] shrink-0 font-semibold tabular-nums" style={{ color: accent }}>
                    {ii + 1}.
                  </span>
                )}
                <span className="min-w-0">{inline(it, `${bi}-${ii}`)}</span>
              </li>
            ))}
          </Tag>
        );
      })}
    </div>
  );
}
