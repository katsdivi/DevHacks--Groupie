import { extractText, getDocumentProxy } from 'unpdf';
import { OfficeParser } from 'officeparser';
import {
  ParsedAssignment,
  parsedAssignmentJsonSchema,
  sanitizeAssignment,
  SKILL_TAGS,
  type ParsedTask,
} from '@groupie/shared';
import { chat } from './llm.ts';
import { env } from './env.ts';

export const MAX_CHARS = 18_000; // about 5K tokens, fits Groq's free 8K TPM with room for the reply
const HEAD_CHARS = 7_000;
const KEY_SECTION = /rubric|grading|criteria|requirement|deliverable|submission|submit|due|deadline|format|presentation|report|marks|points|weight/i;

export async function extractPdfText(data: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(data);
  const { text } = await extractText(pdf, { mergePages: true });
  return normalize(text);
}

const PLAIN = ['txt', 'md', 'markdown', 'csv'];
const OFFICE = ['docx', 'pptx', 'xlsx', 'odt', 'odp', 'ods', 'rtf', 'html', 'htm', 'epub'];
const LEGACY = ['doc', 'ppt', 'xls', 'pages', 'key'];

/** Shown to people when we can't read a file. */
export const SUPPORTED_FORMATS = 'PDF, Word (.docx), PowerPoint (.pptx), Google Docs exports, RTF, ODT, or plain text';

export class UnsupportedFormatError extends Error {
  legacy: boolean;
  constructor(ext: string, legacy: boolean) {
    super(`Unsupported format: ${ext}`);
    this.legacy = legacy;
  }
}

export function fileExtension(fileName: string | undefined, mime: string | undefined): string {
  const ext = /\.([a-z0-9]{1,8})$/i.exec(fileName ?? '')?.[1]?.toLowerCase();
  if (ext) return ext;
  if (mime === 'application/pdf') return 'pdf';
  if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
  if (mime?.startsWith('text/')) return 'txt';
  return '';
}

export function isReadableFormat(ext: string): boolean {
  return ext === 'pdf' || PLAIN.includes(ext) || OFFICE.includes(ext);
}

/** Pulls plain text out of any supported document. */
export async function extractDocumentText(data: Uint8Array, ext: string): Promise<string> {
  if (ext === 'pdf') return extractPdfText(data);
  if (PLAIN.includes(ext)) return normalize(new TextDecoder().decode(data));
  if (OFFICE.includes(ext)) {
    const ast = await OfficeParser.parseOffice(Buffer.from(data));
    return normalize(String((await ast.to('text')).value ?? ''));
  }
  throw new UnsupportedFormatError(ext, LEGACY.includes(ext));
}

export function normalize(text: string): string {
  return text
    .replace(/\r/g, '')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Keeps the start of the document, then the sections most useful for task splitting
 * (rubric, requirements, deliverables) until the budget runs out. Order is preserved.
 */
export function truncateForLlm(text: string, max = MAX_CHARS): string {
  if (text.length <= max) return text;
  const paras = text.split(/\n\n|\n(?=[A-Z0-9][^\n]{0,60}:?\n)/);
  const keep = new Array<boolean>(paras.length).fill(false);
  let used = 0;
  let i = 0;
  for (; i < paras.length && used + paras[i].length <= HEAD_CHARS; i++) {
    keep[i] = true;
    used += paras[i].length + 2;
  }
  // A keyword paragraph plus the two after it, so section bodies come along with their headings.
  let carry = 0;
  for (; i < paras.length; i++) {
    const p = paras[i];
    if (KEY_SECTION.test(p.slice(0, 200))) carry = 3;
    if (carry > 0) {
      carry--;
      if (used + p.length + 2 > max) continue;
      keep[i] = true;
      used += p.length + 2;
    }
  }
  const out: string[] = [];
  paras.forEach((p, idx) => {
    if (keep[idx]) out.push(p);
    else if (out.length && out[out.length - 1] !== '[...]') out.push('[...]');
  });
  return out.join('\n\n').slice(0, max);
}

const INTEGRATE = /integrat|proofread|final review|compile/i;

/** Every split ends with integrate and proofread. Moves an existing one to the end or adds it. */
export function ensureIntegrateTask(tasks: ParsedTask[]): ParsedTask[] {
  const idx = tasks.findIndex((t) => INTEGRATE.test(t.title));
  const rest = tasks.filter((_, i) => i !== idx);
  const last: ParsedTask =
    idx >= 0
      ? tasks[idx]
      : {
          title: 'Integrate and proofread',
          description: "Merge everyone's parts, make it consistent, and proofread the final submission.",
          effort: 2,
          skill_tags: ['editing', 'writing'],
        };
  return [...rest, last].map((t) => ({ ...t, skill_tags: [...new Set(t.skill_tags)] }));
}

function systemPrompt(teamSize: number) {
  return `You break university group assignments into tasks for a team of ${teamSize} students.

Rules:
- Return ${Math.max(6, Math.min(14, teamSize * 2))} to 14 tasks (never fewer than 6). Each task is something one person can own.
- title: short, 2 to 6 words, imperative ("Write literature review").
- description: one line, under 100 characters.
- effort: exactly one of 1, 2, 3, 5, 8. 1 = under an hour, 2 = a couple of hours, 3 = half a day, 5 = a full day, 8 = several days. Use the real size of the work; do not make everything the same.
- skill_tags: 1 to 3 from: ${SKILL_TAGS.join(', ')}.
- The last task must be "Integrate and proofread".
- assignment_title: the assignment's name as written in the document, short.
- due_date: YYYY-MM-DD if the document states a due date, else null. If the year is missing, pick the next upcoming date.
- Only use what's in the document. Do not invent requirements.`;
}

function extractJson(raw: string): unknown {
  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  return JSON.parse(start >= 0 ? cleaned.slice(start, end + 1) : cleaned);
}

export class ParseError extends Error {}

export async function parseAssignment(text: string, teamSize: number, onWait?: () => void): Promise<ParsedAssignment> {
  const today = new Date().toISOString().slice(0, 10);
  const user = `Today is ${today}.\n\nAssignment document:\n"""\n${truncateForLlm(text)}\n"""`;
  const messages = [
    { role: 'system' as const, content: systemPrompt(teamSize) },
    { role: 'user' as const, content: user },
  ];
  const attempts = [
    { model: env.parseModel, strict: true },
    { model: env.parseModel, strict: true },
    { model: env.fallbackModel, strict: false },
  ];
  let lastError: unknown;
  for (const a of attempts) {
    try {
      const raw = await chat({
        model: a.model,
        messages: a.strict
          ? messages
          : [{ role: 'system', content: `${messages[0].content}\n\nReply with only a JSON object matching this schema:\n${JSON.stringify(parsedAssignmentJsonSchema)}` }, messages[1]],
        jsonSchema: a.strict ? { name: 'assignment', schema: parsedAssignmentJsonSchema } : undefined,
        jsonObject: !a.strict,
        maxTokens: 4096,
        reasoningEffort: a.model.startsWith('openai/gpt-oss') ? 'low' : undefined,
        onWait,
      });
      if (env.devMode) console.log(`[parse] ${a.model} raw:`, raw.slice(0, 4000));
      const parsed = ParsedAssignment.parse(sanitizeAssignment(extractJson(raw)));
      return { ...parsed, tasks: ensureIntegrateTask(parsed.tasks) };
    } catch (err) {
      lastError = err;
      console.warn(`[parse] ${a.model} failed:`, err instanceof Error ? err.message.slice(0, 300) : err);
    }
  }
  throw new ParseError(`Could not parse assignment: ${lastError instanceof Error ? lastError.message : lastError}`);
}
