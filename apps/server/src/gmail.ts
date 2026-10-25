import { gmail } from '@googleapis/gmail';
import { authorizedClient, googleConfigured } from './calendar.ts';

export type Attachment = { filename: string; contentType: string; content: string | Buffer };
export type Email = { to: string[]; subject: string; text: string; html: string; attachments?: Attachment[] };

const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64');
/** RFC 2047 so names and emoji survive in headers. */
const header = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);
const wrap = (s: string) => s.replace(/.{1,76}/g, '$&\r\n').trimEnd();

/** Builds a multipart MIME message (text + html, optional attachments). */
export function buildMime(mail: Email, from = 'Groupie'): string {
  const mixed = `mixed_${Math.random().toString(36).slice(2)}`;
  const alt = `alt_${Math.random().toString(36).slice(2)}`;
  const lines = [
    `From: ${header(from)} <me>`,
    `To: ${mail.to.join(', ')}`,
    `Subject: ${header(mail.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
    '',
    `--${mixed}`,
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    '',
    `--${alt}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrap(b64(mail.text)),
    `--${alt}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrap(b64(mail.html)),
    `--${alt}--`,
  ];
  for (const a of mail.attachments ?? []) {
    lines.push(
      `--${mixed}`,
      `Content-Type: ${a.contentType}; name="${a.filename}"`,
      `Content-Disposition: attachment; filename="${a.filename}"`,
      'Content-Transfer-Encoding: base64',
      '',
      wrap(b64(a.content)),
    );
  }
  lines.push(`--${mixed}--`, '');
  return lines.join('\r\n');
}

/** Sends from the authorized Google account. Returns the Gmail message id. */
export async function sendEmail(mail: Email): Promise<string> {
  if (!googleConfigured()) throw new Error('Google is not connected');
  if (!mail.to.length) throw new Error('No recipients');
  const api = gmail({ version: 'v1', auth: authorizedClient() });
  const raw = Buffer.from(buildMime(mail)).toString('base64url');
  const res = await api.users.messages.send({ userId: 'me', requestBody: { raw } });
  return res.data.id ?? '';
}
