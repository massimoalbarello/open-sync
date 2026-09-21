import TurndownService from 'turndown';
import type { z } from 'zod';
import type { payloadSchema } from './attachments';
import type { responseSchema } from './models';

type Message = z.infer<typeof responseSchema>['threads'][number]['messages'][number];

/** This example chooses Markdown and retains full structured messages. Other sources choose their own split. */
export function threadContent(messages: Message[]) {
  const converter = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
  converter.remove(['script', 'style']);
  const text = (value: string) =>
    converter.escape(
      value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
    );
  return {
    format: 'markdown' as const,
    body: [
      `# ${text(messages[0]!.subject)}`,
      ...messages.map((message) => {
        const html = htmlBody(message.payload);
        return [
          `## ${text(message.sender)}`,
          `${message.messageTimestamp} · To: ${text(message.to)}`,
          html === undefined ? text(message.messageText) : converter.turndown(html),
        ].join('\n\n');
      }),
    ].join('\n\n---\n\n'),
  };
}
function htmlBody(part: z.infer<typeof payloadSchema>): string | undefined {
  if (!part || part.filename) {
    return;
  }
  if (part.mimeType === 'text/html' && part.body?.data !== undefined) {
    return Buffer.from(part.body.data, 'base64url').toString('utf8');
  }
  for (const child of part.parts ?? []) {
    const html = htmlBody(child);
    if (html !== undefined) {
      return html;
    }
  }
}
