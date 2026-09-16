import type { SyncContext } from '@open-sync/core/definition';
import type { JsonObject } from '@open-sync/core/json';
import { z } from 'zod';

export class ExpiredCursor extends Error {}
const objectSchema = z.record(z.string(), z.unknown());
export const object = (value: unknown) => objectSchema.parse(value);
export async function request(input: {
  context: SyncContext;
  query: string;
  variables?: JsonObject;
}): Promise<Record<string, unknown>> {
  const { context } = input;
  context.signal.throwIfAborted();
  const response = object(
    await context.provider.post({
      path: '/graphql',
      body: { query: input.query, variables: input.variables ?? {} },
    }),
  );
  const ok = 200;
  if (response.status !== ok) {
    throw new Error('GitHub request failed.');
  }
  const body = object(response.data);
  if (
    Array.isArray(body.errors) &&
    body.errors.some((entry) => {
      const error = object(entry);
      return error.type === 'INVALID_CURSOR' || error.type === 'INVALID_CURSOR_ARGUMENTS';
    })
  ) {
    throw new ExpiredCursor('GitHub cursor expired.');
  }
  if (body.errors !== undefined) {
    throw new Error('GitHub returned partial GraphQL data.');
  }
  context.signal.throwIfAborted();
  return object(body.data);
}
