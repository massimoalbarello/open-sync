import { SourceHttpError, type SyncContext } from '@context-use/open-sync/definition';
import type { JsonObject } from '@context-use/open-sync/json';

export class ExpiredPageToken extends Error {}
export class NotFound extends Error {}

export async function request(input: { context: SyncContext; path: string; query?: JsonObject }) {
  input.context.signal.throwIfAborted();
  const response = await input.context.provider.get({ path: input.path, query: input.query });
  const notFound = 404;
  const badRequest = 400;
  const ok = 200;
  if (response.status === notFound) {
    throw new NotFound();
  }
  if (
    response.status === badRequest &&
    input.query?.pageToken &&
    /page[ _-]?token/i.test(JSON.stringify(response.body))
  ) {
    throw new ExpiredPageToken();
  }
  if (response.status !== ok) {
    throw new SourceHttpError(response);
  }
  return response.body;
}
