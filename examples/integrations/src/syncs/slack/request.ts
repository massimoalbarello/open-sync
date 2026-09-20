import type { SyncContext } from '@context-use/open-sync/definition';
import type { JsonObject } from '@context-use/open-sync/json';
import { z } from 'zod';

export class ExpiredCursor extends Error {}
export class ThreadNotFound extends Error {}

export async function request(input: { context: SyncContext; path: string; query?: JsonObject }) {
  const response = await input.context.provider.get({ path: input.path, query: input.query });
  const ok = 200;
  const body = z.object({ ok: z.boolean(), error: z.string().optional() }).passthrough();
  if (response.status !== ok) {
    throw new Error('Slack request failed. The saved page will be retried.');
  }
  const result = body.parse(response.body);
  if (result.error === 'invalid_cursor') {
    throw new ExpiredCursor();
  }
  if (input.path === '/conversations.replies' && result.error === 'thread_not_found') {
    throw new ThreadNotFound();
  }
  if (!result.ok) {
    throw new Error('Slack could not read this account or channel. Check OAuth permissions.');
  }
  return result;
}
