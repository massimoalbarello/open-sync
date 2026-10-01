import type { ProviderResponse } from '@context-use/open-sync/definition';
import type { JsonObject } from '@context-use/open-sync/json';

export function email(input: {
  id: string;
  threadId: string;
  text?: string;
  date?: string;
  labels?: string[];
  parts?: JsonObject[];
}) {
  return {
    id: input.id,
    threadId: input.threadId,
    internalDate: String(Date.parse(input.date ?? '2026-09-19T12:00:00.000Z')),
    labelIds: input.labels ?? ['UNREAD', 'INBOX'],
    payload: {
      mimeType: 'multipart/mixed',
      headers: [
        { name: 'Subject', value: 'Lunch' },
        { name: 'From', value: 'Sam <sam@example.com>' },
        { name: 'To', value: 'alice@example.com' },
      ],
      parts: [
        {
          mimeType: 'text/plain',
          body: { data: Buffer.from(input.text ?? 'Meet at noon?').toString('base64url') },
        },
        ...(input.parts ?? []),
      ],
    },
  };
}
export const reply = (body: JsonObject): Promise<ProviderResponse> =>
  Promise.resolve({ status: 200, headers: {}, body });
export const profile = { emailAddress: 'alice@example.com', historyId: '100' };
