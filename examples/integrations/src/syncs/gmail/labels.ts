import type { SyncContext } from '@context-use/open-sync/definition';
import { z } from 'zod';
import { historyConfigSchema } from '../history';
import { request } from './request';

export const configSchema = historyConfigSchema.extend({
  labels: z.array(z.string().min(1)).optional().meta({
    title: 'Labels',
    description:
      'Sync complete threads with any of these Gmail label names. Leave empty to sync all threads.',
  }),
});

export async function selectedLabelIds(input: { context: SyncContext; names: string[] }) {
  if (!input.names.length) {
    return [];
  }
  const { labels } = z
    .object({ labels: z.array(z.object({ id: z.string().min(1), name: z.string().min(1) })) })
    .parse(await request({ context: input.context, path: '/users/me/labels' }));
  const idsByName = new Map(labels.map((label) => [label.name, label.id]));
  return [...new Set(input.names)].map((name) => {
    const id = idsByName.get(name);
    if (!id) {
      throw new Error(`Gmail label not found: ${name}`);
    }
    return id;
  });
}

export function matchesLabels(input: { messages: { labelIds: string[] }[]; labelIds: string[] }) {
  return (
    !input.labelIds.length ||
    input.messages.some((message) => message.labelIds.some((id) => input.labelIds.includes(id)))
  );
}

export async function threadMatchesLabels(input: {
  context: SyncContext;
  id: string;
  labelIds: string[];
}) {
  const thread = z
    .object({
      id: z.literal(input.id),
      messages: z.array(z.object({ labelIds: z.array(z.string()).default([]) })).min(1),
    })
    .parse(
      await request({
        context: input.context,
        path: `/users/me/threads/${encodeURIComponent(input.id)}`,
        query: { format: 'minimal', fields: 'id,messages(labelIds)' },
      }),
    );
  return matchesLabels({ messages: thread.messages, labelIds: input.labelIds });
}
