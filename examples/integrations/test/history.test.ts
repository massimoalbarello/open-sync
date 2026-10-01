import { expect, test } from 'bun:test';
import type { JsonObject } from '@context-use/open-sync/json';
import { gmailThreads } from '../src/syncs/gmail/definition';
import { historyStart } from '../src/syncs/history';
import { slackThreads } from '../src/syncs/slack/definition';
import { fixture, unused } from './fixture';
import { email, profile, reply } from './gmail-fixture';

test('history presets use calendar months, clamp month ends and leave All unbounded', () => {
  const now = new Date('2024-05-31T12:34:56.000Z');
  expect(historyStart({ config: { history: 'Last 3 months' }, now })?.toISOString()).toBe(
    '2024-02-29T12:34:56.000Z',
  );
  expect(historyStart({ config: { history: 'Last 1 year' }, now })?.toISOString()).toBe(
    '2023-05-31T12:34:56.000Z',
  );
  expect(historyStart({ config: { history: 'Last 3 years' }, now })?.toISOString()).toBe(
    '2021-05-31T12:34:56.000Z',
  );
  expect(historyStart({ config: { history: 'All' }, now })).toBeNull();
  expect(historyStart({ config: {}, now })).toBeNull();
  expect(now.toISOString()).toBe('2024-05-31T12:34:56.000Z');
});

const ranges = [
  { history: 'Last 3 months', count: 1 },
  { history: 'Last 1 year', count: 2 },
  { history: 'Last 3 years', count: 3 },
  { history: 'All', count: 4 },
];
const dayMs = 86_400_000;
const millisecondsPerSecond = 1000;
const agesInDays = { recent: 60, pastYear: 200, pastThreeYears: 700, older: 2000 };

for (const registration of [gmailThreads, slackThreads]) {
  test.each(ranges)(
    `${registration.definition.name} discovers $history across restarts`,
    async ({ history, count }) => {
      const dates = Object.values(agesInDays).map((days) => new Date(Date.now() - days * dayMs));
      const queries: JsonObject[] = [];
      function gmailResponse(input: { path: string; query?: JsonObject }) {
        const { path, query = {} } = input;
        if (path.endsWith('/profile')) {
          return reply(profile);
        }
        if (path.endsWith('/history')) {
          return reply({ historyId: '100' });
        }
        if (!path.endsWith('/threads')) {
          const id = path.split('/').at(-1)!;
          return reply({
            id,
            messages: [email({ id, threadId: id, date: new Date(Number(id)).toISOString() })],
          });
        }
        queries.push(query);
        const search = String(query.q);
        const oldest = Number(search.match(/after:(\d+)/)?.[1] ?? 0) * millisecondsPerSecond;
        const latest = Number(search.match(/before:(\d+)/)?.[1]) * millisecondsPerSecond;
        const matches = dates.filter((date) => date.getTime() > oldest && date.getTime() < latest);
        const index = Number(query.pageToken ?? 0);
        const date = matches[index];
        return reply({
          threads: date ? [{ id: String(date.getTime()) }] : [],
          nextPageToken: index + 1 < matches.length ? String(index + 1) : null,
        });
      }
      function slackResponse({ path, query = {} }: { path: string; query?: JsonObject }) {
        let body: JsonObject;
        if (path === '/auth.test') {
          body = { team_id: 'team', user_id: 'alice', url: 'https://example.slack.com/' };
        } else if (path === '/users.conversations') {
          body = { channels: [{ id: 'general' }] };
        } else if (path === '/conversations.info') {
          body = { channel: { id: query.channel! } };
        } else {
          queries.push(query);
          const matches = dates.filter(
            (date) =>
              date.getTime() / millisecondsPerSecond >= Number(query.oldest) &&
              date.getTime() / millisecondsPerSecond <= Number(query.latest),
          );
          const index = Number(query.cursor ?? 0);
          const date = matches[index];
          body = {
            messages: date
              ? [
                  {
                    ts: `${Math.floor(date.getTime() / millisecondsPerSecond)}.000001`,
                    text: 'Hello',
                  },
                ]
              : [],
            has_more: index + 1 < matches.length,
            response_metadata: {
              next_cursor: index + 1 < matches.length ? String(index + 1) : '',
            },
          };
        }
        return Promise.resolve({ status: 200, headers: {}, body: { ok: true, ...body } });
      }
      const f = await fixture({
        registration,
        config: { history },
        provider: {
          post: unused,
          action: unused,
          get: registration === gmailThreads ? gmailResponse : slackResponse,
        },
      });
      try {
        await f.engine.tick();
        await f.restart();
        await f.finish();
        expect(f.records).toHaveLength(count);
        if (registration === gmailThreads) {
          expect(new Set(queries.map((query) => query.q)).size).toBe(1);
        } else {
          expect(new Set(queries.map((query) => query.oldest)).size).toBe(1);
          expect(new Set(queries.map((query) => query.latest)).size).toBe(1);
        }
      } finally {
        await f.close();
      }
    },
  );
}
