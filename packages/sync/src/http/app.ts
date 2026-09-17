import { Elysia } from 'elysia';
import type { SyncApi } from '../api';
import type { Scope } from '../models/identity';
import type { ProviderService } from '../services/providers/service';
import { createSyncController } from './controller';
import { syncErrorResponse } from './index';
import { createProviderController } from './providers';

export function createHttpApp<Prefix extends string>(input: {
  prefix: Prefix;
  api: SyncApi;
  providers: ProviderService;
  authorize(request: Request): Scope | null | Promise<Scope | null>;
  authorizationRedirect?(input: { service: string; outcome: 'connected' | 'failed' }): string;
}) {
  return new Elysia({ prefix: input.prefix })
    .onError(({ error }) => syncErrorResponse(error))
    .use(createSyncController(input))
    .use(createProviderController(input));
}
export type OpenSyncHttp<Prefix extends string = ''> = ReturnType<typeof createHttpApp<Prefix>>;
