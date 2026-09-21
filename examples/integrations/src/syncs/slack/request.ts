import { SourceHttpError, type SyncContext } from '@context-use/open-sync/definition';
import type { JsonObject } from '@context-use/open-sync/json';
import { z } from 'zod';

export class ExpiredCursor extends Error {}
export class ThreadNotFound extends Error {}

export async function request(input: { context: SyncContext; path: string; query?: JsonObject }) {
  const response = await input.context.provider.get({ path: input.path, query: input.query });
  const ok = 200;
  const body = z.object({ ok: z.boolean(), error: z.string().optional() }).passthrough();
  if (response.status !== ok) {
    throw new SourceHttpError(response);
  }
  const result = body.parse(response.body);
  if (result.error === 'invalid_cursor') {
    throw new ExpiredCursor();
  }
  if (input.path === '/conversations.replies' && result.error === 'thread_not_found') {
    throw new ThreadNotFound();
  }
  if (!result.ok) {
    const statuses: Record<string, number> = {
      ratelimited: 429,
      rate_limited: 429,
      token_revoked: 401,
      invalid_auth: 401,
      not_authed: 401,
      account_inactive: 401,
      missing_scope: 403,
      no_permission: 403,
      restricted_action: 403,
    };
    const unavailable = 503;
    throw new SourceHttpError({
      status: statuses[result.error ?? ''] ?? unavailable,
      headers: response.headers,
    });
  }
  return result;
}
