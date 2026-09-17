import { status } from 'elysia';
import { SyncError } from '../models/error';

export type { OpenSyncHttp } from './app';

const notFound = 404;
const conflict = 409;
const unauthorized = 401;
const forbidden = 403;
const invalidInput = 400;
export function syncErrorResponse(error: unknown) {
  if (error instanceof SyncError) {
    return status(
      ({ not_found: notFound, busy: conflict, unauthorized, forbidden } as Record<string, number>)[
        error.code
      ] ?? invalidInput,
      { error: error.code },
    );
  }
}
