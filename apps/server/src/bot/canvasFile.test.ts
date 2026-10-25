import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { ParsedAssignment } from '@groupie/shared';

vi.mock('../parse.ts', async (orig) => ({ ...(await orig<typeof import('../parse.ts')>()), parseAssignment: vi.fn() }));
vi.mock('./split.ts', async (orig) => ({ ...(await orig<typeof import('./split.ts')>()), postSplitCard: vi.fn(async () => {}) }));

const { db, schema } = await import('../db/index.ts');
const { bot } = await import('./index.ts');
const { parseAssignment } = await import('../parse.ts');
const { postSplitCard } = await import('./split.ts');
const { getGroup, getTasks, saveAssignment, setTeamSize, upsertGroup } = await import('../groups.ts');
const F = await import('../canvas/fileAttach.ts');
const { assignmentSource } = await import('../canvas/assignmentSource.ts');
const { deleteGroup } = await import('../groups.ts');

const parse = vi.mocked(parseAssignment);
const splitCard = vi.mocked(postSplitCard);
const GROUP = -4004;
const USER = 8080;
const SPEC =
  'Group project brief. Interview five students about campus dining and write a summary. Build wireframes for four screens. ' +
  'Write a requirements document with ten user stories. Build a prototype with search and opening hours. Present a demo in class.';
const OTHER =
  'Lab safety quiz. Read chapter seven on chemical storage and answer twenty multiple choice questions about goggles, fume hoods, ' +
  'spill kits and waste labels. Submit the signed safety contract before the first wet lab session next Tuesday morning.';

type Call = { method: string; payload: Record<string, unknown> };
let calls: Call[] = [];
let msgId = 900;
let fileBody = SPEC;
const plan = (title: string): ParsedAssignment => ({
  assignment_title: title,
  due_date: null,
  tasks: [
    { title: `${title} task A`, description: 'a', effort: 3, skill_tags: [] },
    { title: `${title} task B`, description: 'b', effort: 2, skill_tags: [] },
  ],
});

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
    const chat = { id: GROUP, type: 'group', title: 'T' };
    if (method === 'getFile') return { ok: true, result: { file_id: 'f', file_unique_id: 'u', file_path: 'documents/file.txt' } } as never;
    const result = method === 'sendMessage' ? { message_id: ++msgId, date: 0, chat } : true;
    return { ok: true, result } as never;
  });
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(fileBody));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => vi.restoreAllMocks());

/** A group whose assignment came from a text-only Canvas import of SPEC. */
function importedGroup(status: 'collecting_members' | 'split_ready' = 'collecting_members') {
  db.delete(schema.groups).where(eq(schema.groups.id, GROUP)).run();
  upsertGroup(GROUP, 'Team');
  setTeamSize(GROUP, 4);
  saveAssignment(GROUP, plan('Imported'));
  const importId = db
    .insert(schema.cubbieImports)
    .values({
      pairCode: 'K7Q2MX',
      telegramUserId: USER,
      groupChatId: GROUP,
      payload: {
        course: { name: 'C' },
        assignment: { title: 'Imported', dueAt: '2026-11-20T23:59:00-07:00', descriptionText: '' },
        attachments: [{ filename: 'brief.docx', mimeType: 'application/msword', text: SPEC }],
      },
      status: 'imported',
      createdAt: new Date().toISOString(),
    })
    .returning({ id: schema.cubbieImports.id })
    .get().id;
  db.update(schema.groups).set({ canvasImportId: importId, status }).where(eq(schema.groups.id, GROUP)).run();
}

let updateId = 1;
const drop = (name = 'spec.txt') =>
  bot.handleUpdate({
    update_id: updateId++,
    message: {
      message_id: 50,
      date: 0,
      chat: { id: GROUP, type: 'group', title: 'T' },
      from: { id: USER, is_bot: false, first_name: 'Ana' },
      document: { file_id: 'file-1', file_unique_id: 'u1', file_name: name, mime_type: 'text/plain', file_size: 300 },
    },
  });
const tap = (data: string, messageId: number) =>
  bot.handleUpdate({
    update_id: updateId++,
    callback_query: {
      id: 'cb',
      from: { id: USER, is_bot: false, first_name: 'Ana' },
      chat_instance: 'ci',
      data,
      message: { message_id: messageId, date: 0, chat: { id: GROUP, type: 'group', title: 'T' }, text: F.ASK_UPDATE },
    },
  });
const texts = () => calls.filter((c) => c.method === 'sendMessage' || c.method === 'editMessageText').map((c) => String(c.payload.text));
const asked = () => calls.find((c) => c.method === 'sendMessage' && c.payload.text === F.ASK_UPDATE);

beforeEach(() => {
  calls = [];
  parse.mockReset();
  splitCard.mockClear();
  fileBody = SPEC;
});

describe('similarity', () => {
  it('scores the same text 1 and unrelated text low', () => {
    expect(F.similarityToImport(SPEC, [SPEC])).toBe(1);
    expect(F.similarityToImport(OTHER, [SPEC])).toBeLessThan(F.SIMILARITY_THRESHOLD);
    // A file with a bit more text than Canvas sent still counts as the same.
    expect(F.similarityToImport(`${SPEC} Due Friday.`, ['Short description', SPEC])).toBeGreaterThanOrEqual(F.SIMILARITY_THRESHOLD);
  });
});

describe('a file dropped after a text-only Canvas import', () => {
  it('attaches a similar file without asking or making a second task list', async () => {
    importedGroup();
    await drop();
    expect(texts()).toEqual([F.FILE_ATTACHED]);
    expect(asked()).toBeUndefined();
    expect(parse).not.toHaveBeenCalled();
    expect(getGroup(GROUP)!.canvasFileAt).not.toBeNull();
    expect(getTasks(GROUP).map((t) => t.title)).toEqual(['Imported task A', 'Imported task B']);
    // Nothing goes to Canvas: the only download is the Telegram file.
    for (const c of vi.mocked(fetch).mock.calls) expect(String(c[0])).toMatch(/^https:\/\/api\.telegram\.org\/file\//);
  });
  it('lets a second file pass by without a new task list', async () => {
    importedGroup();
    await drop();
    calls = [];
    await drop('another.txt');
    expect(texts()).toEqual([]);
    expect(parse).not.toHaveBeenCalled();
  });
  it('asks when the file clearly differs, and Keep current changes nothing', async () => {
    importedGroup();
    fileBody = OTHER;
    await drop();
    expect(texts()).toEqual([F.FILE_ATTACHED, F.ASK_UPDATE]);
    const ask = asked()!;
    expect(JSON.stringify(ask.payload.reply_markup)).toContain(F.UPDATE_DATA);
    expect(JSON.stringify(ask.payload.reply_markup)).toContain(F.KEEP_BUTTON);
    const askId = msgId;
    calls = [];
    await tap(F.KEEP_DATA, askId);
    expect(texts()).toEqual([F.KEPT_TEXT]);
    expect(parse).not.toHaveBeenCalled();
    expect(getTasks(GROUP).map((t) => t.title)).toEqual(['Imported task A', 'Imported task B']);
    // The question is spent: a late Update does nothing.
    calls = [];
    await tap(F.UPDATE_DATA, askId);
    expect(parse).not.toHaveBeenCalled();
    expect(calls.find((c) => c.method === 'answerCallbackQuery')!.payload.text).toBe(F.PROMPT_GONE_TEXT);
  });
  it('Update re-reads the tasks from the file and keeps the Canvas due date, no split before', async () => {
    importedGroup();
    fileBody = OTHER;
    await drop();
    const askId = msgId;
    parse.mockResolvedValue(plan('From file'));
    calls = [];
    await tap(F.UPDATE_DATA, askId);
    expect(parse.mock.calls[0]![0]).toContain('Lab safety quiz');
    expect(getTasks(GROUP).map((t) => t.title)).toEqual(['From file task A', 'From file task B']);
    expect(getGroup(GROUP)!.dueDate).toBe('2026-11-20');
    expect(texts()).toContain(F.UPDATED_TEXT);
    expect(texts().some((t) => t.includes('From file'))).toBe(true);
    expect(splitCard).not.toHaveBeenCalled();
    expect(getGroup(GROUP)!.status).toBe('collecting_members');
  });
  it('Update re-splits when a split existed and keeps the group status', async () => {
    importedGroup('split_ready');
    fileBody = OTHER;
    await drop();
    parse.mockResolvedValue(plan('From file'));
    await tap(F.UPDATE_DATA, msgId);
    expect(splitCard).toHaveBeenCalledTimes(1);
    expect(getGroup(GROUP)!.status).toBe('split_ready');
  });
  it('keeps the current tasks when the re-read fails', async () => {
    importedGroup();
    fileBody = OTHER;
    await drop();
    parse.mockRejectedValue(new Error('llm down'));
    calls = [];
    await tap(F.UPDATE_DATA, msgId);
    expect(texts()).toContain(F.UPDATE_FAILED_TEXT);
    expect(getTasks(GROUP).map((t) => t.title)).toEqual(['Imported task A', 'Imported task B']);
  });
  it('does not attach after an import that brought the file as bytes', async () => {
    importedGroup();
    const row = db.select().from(schema.cubbieImports).all().at(-1)!;
    db.update(schema.cubbieImports)
      .set({ payload: { ...(row.payload as object), attachments: [{ filename: 'spec.pdf', mimeType: 'application/pdf', base64Length: 100 }] } })
      .where(eq(schema.cubbieImports.id, row.id))
      .run();
    await drop();
    expect(texts()).toEqual([]);
    expect(parse).not.toHaveBeenCalled();
  });
});

describe('assignmentSource', () => {
  it('returns the attached file, the Canvas text and the title for this group only, and clears on /reset', async () => {
    importedGroup();
    await drop();
    expect(assignmentSource(GROUP)).toEqual({
      title: 'Imported',
      fileId: 'file-1',
      fileName: 'spec.txt',
      mimeType: 'text/plain',
      canvasText: SPEC,
    });
    upsertGroup(-4005, 'Other');
    expect(assignmentSource(-4005)).toEqual({});
    deleteGroup(GROUP);
    expect(assignmentSource(GROUP)).toEqual({});
  });
  it('keeps the file of a dropped PDF that became the assignment', async () => {
    db.delete(schema.groups).where(eq(schema.groups.id, GROUP)).run();
    upsertGroup(GROUP, 'Team');
    setTeamSize(GROUP, 4);
    parse.mockResolvedValue(plan('Dropped'));
    await drop('brief.txt');
    expect(getTasks(GROUP).map((t) => t.title)).toEqual(['Dropped task A', 'Dropped task B']);
    expect(assignmentSource(GROUP)).toEqual({ title: 'Dropped', fileId: 'file-1', fileName: 'brief.txt', mimeType: 'text/plain' });
  });
});
