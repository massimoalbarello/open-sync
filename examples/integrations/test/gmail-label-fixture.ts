import { SourceHttpError } from '@context-use/open-sync/definition';
import type { JsonObject } from '@context-use/open-sync/json';
import { gmailThreads } from '../src/syncs/gmail/definition';
import { fixture, unused } from './fixture';
import { email, profile, reply } from './gmail-fixture';

export const labelNames: [string, string] = ['Clients / "Europe"', 'Research {active}'];
export const labelIds: [string, string] = ['Label_clients', 'Label_research'];

export async function labelFixture(input: {
  config?: JsonObject;
  threads: Record<string, ReturnType<typeof email>[]>;
}) {
  const requests: { path: string; query?: JsonObject }[] = [];
  const downloads: string[] = [];
  const changes = { ids: [] as string[], historyId: profile.historyId };
  const failedDownloads = new Set<string>();
  function listing(query: JsonObject) {
    const selected = (query.labelIds as string[] | undefined)?.[0];
    const ids = Object.entries(input.threads)
      .filter(([, messages]) => !selected || messages.some((m) => m.labelIds.includes(selected)))
      .map(([id]) => id);
    const index = Number(query.pageToken ?? 0);
    return reply({
      threads: ids[index] ? [{ id: ids[index]! }] : [],
      ...(index + 1 < ids.length ? { nextPageToken: String(index + 1) } : {}),
    });
  }
  const f = await fixture({
    registration: gmailThreads,
    config: input.config ?? { labels: labelNames },
    provider: {
      action: unused,
      post: unused,
      download({ input }) {
        downloads.push(String(input.messageId));
        if (failedDownloads.has(String(input.messageId))) {
          const unavailable = 503;
          throw new SourceHttpError({ status: unavailable });
        }
        return Promise.resolve(new Blob(['attachment']).stream());
      },
      get(request) {
        requests.push(request);
        const { path, query = {} } = request;
        if (path.endsWith('/profile')) {
          return reply({ ...profile, historyId: changes.historyId });
        }
        if (path.endsWith('/labels')) {
          return reply({
            labels: [
              { name: labelNames[0], id: labelIds[0] },
              { name: labelNames[1], id: labelIds[1] },
            ],
          });
        }
        if (path.endsWith('/history')) {
          return reply({
            historyId: changes.historyId,
            history:
              query.startHistoryId === changes.historyId
                ? []
                : [{ messages: changes.ids.map((threadId) => ({ threadId })) }],
          });
        }
        if (path.endsWith('/threads')) {
          return listing(query);
        }
        const id = path.split('/').at(-1)!;
        const messages = input.threads[id];
        if (!messages) {
          return Promise.resolve({ status: 404, headers: {}, body: {} });
        }
        return reply({
          id,
          messages:
            query.format === 'minimal'
              ? messages.map((message) => ({ labelIds: message.labelIds }))
              : messages,
        });
      },
    },
  });
  return Object.assign(f, { requests, downloads, changes, failedDownloads });
}

export function labelledMessage(input: { id: string; labels?: string[]; date?: string }) {
  return email({
    id: `${input.id}-root`,
    threadId: input.id,
    date: input.date,
    labels: input.labels ?? [labelIds[0]!],
    parts: [
      {
        partId: 'file',
        filename: `${input.id}.txt`,
        body: { attachmentId: input.id },
      },
    ],
  });
}
