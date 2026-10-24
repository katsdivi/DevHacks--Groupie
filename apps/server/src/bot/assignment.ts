import { Composer, type Context } from 'grammy';
import type { ParsedAssignment } from '@groupie/shared';
import { env } from '../env.ts';
import { countMembers, getGroup, saveAssignment } from '../groups.ts';
import { extractPdfText, parseAssignment } from '../parse.ts';
import { html } from './format.ts';

export const assignment = new Composer();

const MAX_BYTES = 20 * 1024 * 1024; // Bot API download limit
const inFlight = new Set<number>();

export function formatDue(due: string | null, tz: string): string | null {
  if (!due) return null;
  const d = new Date(`${due.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: tz });
}

export function taskListText(nickname: string, parsed: ParsedAssignment, tz: string): string {
  const points = parsed.tasks.reduce((s, t) => s + t.effort, 0);
  const due = formatDue(parsed.due_date, tz);
  const lines = parsed.tasks.map((t) => `<code>${String(t.effort).padStart(2, ' ')} pt</code>  ${html(t.title)}`);
  return [
    `<b>Got it: ${html(parsed.assignment_title)}</b>`,
    [due && `Due ${due}`, `${parsed.tasks.length} tasks`, `${points} points`].filter(Boolean).join(' · '),
    '',
    ...lines,
    '',
    `${html(nickname)} here. Next, everyone adds their details and I split this so nobody carries the team.`,
  ].join('\n');
}

async function download(ctx: Context, fileId: string): Promise<Uint8Array> {
  const file = await ctx.api.getFile(fileId);
  const res = await fetch(`https://api.telegram.org/file/bot${env.botToken}/${file.file_path}`);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

assignment.on('message:document', async (ctx, next) => {
  const doc = ctx.msg.document;
  const isPdf = doc.mime_type === 'application/pdf' || doc.file_name?.toLowerCase().endsWith('.pdf');
  if (!isPdf || (ctx.chat.type !== 'group' && ctx.chat.type !== 'supergroup')) return next();

  const group = getGroup(ctx.chat.id);
  const reply = (text: string) =>
    ctx.reply(text, { parse_mode: 'HTML', reply_parameters: { message_id: ctx.msg.message_id } });

  if (!group || !group.teamSize) {
    await reply("Ooh, homework. Tell me the team size first: send /setup, pick a number, then drop the PDF again.");
    return;
  }
  if (group.status !== 'setup' && !(group.status === 'collecting_members' && countMembers(group.id) === 0)) {
    await reply(`${html(group.nickname)} here. I already have this group's assignment. Use /reset to start over.`);
    return;
  }
  if ((doc.file_size ?? 0) > MAX_BYTES) {
    await reply('That file is too big for me (20 MB max). Can you send a smaller PDF?');
    return;
  }
  if (inFlight.has(group.id)) {
    await reply("Still reading the last one. Give me a sec!");
    return;
  }

  inFlight.add(group.id);
  const status = await reply(`Reading <b>${html(doc.file_name ?? 'the assignment')}</b>. Give me a sec...`);
  const edit = (text: string) => ctx.api.editMessageText(ctx.chat.id, status.message_id, text, { parse_mode: 'HTML' });
  const typing = setInterval(() => ctx.replyWithChatAction('typing').catch(() => {}), 4500);
  try {
    await ctx.replyWithChatAction('typing').catch(() => {});
    const text = await extractPdfText(await download(ctx, doc.file_id));
    if (text.replace(/\s/g, '').length < 50) {
      await edit("Hmm, that PDF looks like a scan, so I can't read the text. Can you send one with selectable text?");
      return;
    }
    const parsed = await parseAssignment(text, group.teamSize, () => {
      edit('Thinking, one sec...').catch(() => {});
    });
    saveAssignment(group.id, parsed);
    if (group.statusMessageId) {
      await ctx.api.editMessageReplyMarkup(ctx.chat.id, group.statusMessageId).catch(() => {});
    }
    await edit(taskListText(group.nickname, parsed, group.tz));
  } catch (err) {
    console.error('Assignment parse failed', err);
    await edit("I couldn't make sense of that one. Try sending it again, or a different PDF?").catch(() => {});
  } finally {
    clearInterval(typing);
    inFlight.delete(group.id);
  }
});
