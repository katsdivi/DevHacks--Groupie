import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Update } from 'grammy/types';
import { eq } from 'drizzle-orm';

// No model and no browser: the chat model must not run for file requests, and the PDF is a stub.
vi.mock('../llm.ts', async (orig) => ({ ...(await orig<typeof import('../llm.ts')>()), talk: vi.fn(async () => 'MODEL ANSWER') }));
vi.mock('../cards/render.ts', () => ({
  renderPng: vi.fn(async () => Buffer.from('png')),
  renderPdf: vi.fn(async () => Buffer.from('%PDF-1.4 stub')),
  closeRenderer: vi.fn(async () => {}),
}));

const { talk } = await import('../llm.ts');
const { renderPdf } = await import('../cards/render.ts');
const { db, schema } = await import('../db/index.ts');
const { bot } = await import('./index.ts');
const { upsertMember } = await import('../members.ts');
const { saveAssignment } = await import('../groups.ts');
const { buildContext, renderContext } = await import('../contextPolicy.ts');
const { wantsAssignmentFile, groupsWithAssignment, sendAssignment, assignmentPdfHtml } = await import('./assignmentFile.ts');
const copy = await import('../copy.ts');

type Call = { method: string; payload: Record<string, unknown> };
let calls: Call[] = [];
let msgId = 5000;

beforeAll(() => {
  bot.botInfo = {
    id: 1,
    is_bot: true,
    first_name: 'Groupie',
    username: 'CubbieGroupieBot',
    can_join_groups: true,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
    can_connect_to_business: false,
    has_main_web_app: false,
    has_topics_enabled: false,
    allows_users_to_create_topics: false,
  } as typeof bot.botInfo;
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    const chatId = (payload as { chat_id?: number }).chat_id ?? 0;
    const result = method.startsWith('send') ? { message_id: ++msgId, date: 0, chat: { id: chatId, type: chatId < 0 ? 'group' : 'private' } } : true;
    return { ok: true, result } as never;
  });
});
afterEach(() => {
  calls = [];
  vi.mocked(talk).mockClear();
  vi.mocked(renderPdf).mockClear();
});

const ME = 4242;
const OTHER = 4343;
let nextGroup = -9700;
const TASKS = [{ title: 'Write the report', description: '', effort: 3 as const, skill_tags: [] }];

function makeGroup(opts: { text?: string; fileId?: string; canvas?: boolean; title?: string } = {}) {
  const id = nextGroup--;
  db.insert(schema.groups).values({ id, title: 'Team', nickname: 'Motu', status: 'collecting_members', teamSize: 2, tz: 'America/Phoenix', createdAt: 'x' }).run();
  saveAssignment(id, { assignment_title: opts.title ?? 'Sprint 3 Report', due_date: '2026-10-27', tasks: TASKS });
  const set: Partial<typeof schema.groups.$inferInsert> = {};
  if (opts.text) set.assignmentText = opts.text;
  if (opts.fileId) Object.assign(set, { assignmentFileId: opts.fileId, assignmentFileName: 'spec.pdf', assignmentFileMime: 'application/pdf' });
  if (opts.canvas) {
    const row = db
      .insert(schema.cubbieImports)
      .values({
        pairCode: 'ABCDEF',
        telegramUserId: ME,
        groupChatId: id,
        status: 'imported',
        createdAt: 'x',
        payload: { pairCode: 'ABCDEF', course: { name: 'CSE 485' }, assignment: { title: 'Sprint 3', dueAt: null, descriptionText: '' }, attachments: [{ filename: 't.docx', mimeType: 'x', text: 'CANVAS TEXT: 6 pages, IEEE format.' }] },
      } as typeof schema.cubbieImports.$inferInsert)
      .returning({ id: schema.cubbieImports.id })
      .get();
    set.canvasImportId = row.id;
  }
  if (Object.keys(set).length) db.update(schema.groups).set(set).where(eq(schema.groups.id, id)).run();
  return id;
}

const text = (chatId: number, body: string, chatType: 'group' | 'private'): Update =>
  ({
    update_id: ++msgId,
    message: { message_id: ++msgId, date: 0, chat: chatType === 'group' ? { id: chatId, type: 'group', title: 'Team' } : { id: chatId, type: 'private', first_name: 'Me' }, from: { id: ME, is_bot: false, first_name: 'Me' }, text: body },
  }) as Update;

describe('wantsAssignmentFile', () => {
  it.each([
    'send me the assignment',
    'can you send the pdf?',
    'give us the instructions',
    'I want the assignment file',
    'can I have the original pdf',
    "where's the pdf",
    'resend the doc',
    'the pdf please',
    'dm me a copy of the assignment',
  ])('asks for the file: %s', (q) => expect(wantsAssignmentFile(q)).toBe(true));
  it.each([
    'do we need to submit a pdf?',
    'what does the assignment say about citations?',
    'how long should the report be?',
    "what's due this week?",
    'who has the file upload task?',
  ])('is a question, not a file request: %s', (q) => expect(wantsAssignmentFile(q)).toBe(false));
});

describe('sendAssignment', () => {
  it('re-sends the original Telegram file when the group has one', async () => {
    const g = makeGroup({ fileId: 'FILE123', text: 'some text' });
    expect(await sendAssignment(g, g)).toBe('file');
    const doc = calls.find((c) => c.method === 'sendDocument')!;
    expect(doc.payload.document).toBe('FILE123');
    expect(doc.payload.caption).toBe(copy.fileCaption('Sprint 3 Report'));
    expect(renderPdf).not.toHaveBeenCalled();
  });

  it('makes a PDF from the Canvas text when only text came through, and says so', async () => {
    const g = makeGroup({ canvas: true });
    expect(await sendAssignment(g, g)).toBe('pdf');
    expect(vi.mocked(renderPdf).mock.calls[0]![0]).toContain('CANVAS TEXT: 6 pages, IEEE format.');
    const doc = calls.find((c) => c.method === 'sendDocument')!;
    expect(doc.payload.caption).toBe(copy.CANVAS_PDF_CAPTION);
  });

  it('falls back to a PDF when re-sending the file fails', async () => {
    const g = makeGroup({ fileId: 'GONE', text: 'Pasted assignment text that is long enough.' });
    let first = true;
    bot.api.config.use(async (prev, method, payload, signal) => {
      if (method === 'sendDocument' && first) {
        first = false;
        throw new Error('file gone');
      }
      return prev(method, payload, signal);
    });
    vi.spyOn(console, 'error').mockImplementationOnce(() => {});
    expect(await sendAssignment(g, g)).toBe('pdf');
    expect(calls.filter((c) => c.method === 'sendDocument').at(-1)!.payload.caption).toBe(copy.TEXT_PDF_CAPTION);
  });

  it('says there is no assignment yet when there is none', async () => {
    const id = nextGroup--;
    db.insert(schema.groups).values({ id, title: 'Empty', status: 'setup', tz: 'America/Phoenix', createdAt: 'x' }).run();
    expect(await sendAssignment(id, id)).toBe('none');
    expect(calls.at(-1)!.payload.text).toBe(copy.NO_ASSIGNMENT_FILE);
  });

  it('escapes the text in the PDF page', () => {
    expect(assignmentPdfHtml('<b>T</b>', 'sub', 'a < b & c')).toContain('a &lt; b &amp; c');
  });
});

describe('asking the bot', () => {
  it('in the group, an addressed file request sends the file with no model call', async () => {
    const g = makeGroup({ fileId: 'GROUPFILE' });
    await bot.handleUpdate(text(g, 'Motu, send me the assignment', 'group'));
    expect(calls.some((c) => c.method === 'sendDocument' && c.payload.document === 'GROUPFILE' && c.payload.chat_id === g)).toBe(true);
    expect(talk).not.toHaveBeenCalled();
  });

  it("in a DM, sends the newest assignment from the sender's own groups only", async () => {
    const theirs = makeGroup({ fileId: 'NOT_MINE' });
    upsertMember(theirs, OTHER, { name: 'Other', skills: [], weak_areas: [] });
    const older = makeGroup({ fileId: 'OLDER' });
    const newer = makeGroup({ fileId: 'NEWER' });
    for (const g of [older, newer]) upsertMember(g, ME, { name: 'Me', skills: [], weak_areas: [] });
    expect(groupsWithAssignment(ME).slice(0, 2)).toEqual([newer, older]);
    await bot.handleUpdate(text(ME, 'can you send me the pdf?', 'private'));
    const doc = calls.find((c) => c.method === 'sendDocument')!;
    expect(doc.payload).toMatchObject({ chat_id: ME, document: 'NEWER' });
    expect(talk).not.toHaveBeenCalled();
  });

  it('in a DM with no groups, says there is nothing yet', async () => {
    await bot.handleUpdate({ ...text(777001, 'send me the assignment', 'private'), message: { ...text(777001, 'send me the assignment', 'private').message!, from: { id: 777001, is_bot: false, first_name: 'X' } } } as Update);
    expect(calls.at(-1)!.payload.text).toBe(copy.NO_ASSIGNMENT_FILE);
  });
});

describe('questions about the assignment', () => {
  it('the group facts include the assignment text, so the model can answer from it', () => {
    const g = makeGroup({ text: 'The report must be 6 to 8 pages in IEEE format.' });
    upsertMember(g, ME, { name: 'Me', skills: [], weak_areas: [] });
    const rendered = renderContext(buildContext({ askerId: ME, groupChatId: g, mode: 'group' }));
    expect(rendered).toContain('Assignment instructions');
    expect(rendered).toContain('6 to 8 pages in IEEE format');
  });
});
