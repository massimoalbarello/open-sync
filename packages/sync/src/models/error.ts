import type { JsonObject } from './json';

export class SyncError extends Error {
  readonly code: string;
  readonly diagnostics?: JsonObject;
  readonly status?: number;
  constructor(input: {
    code: string;
    message: string;
    diagnostics?: JsonObject;
    status?: number;
  }) {
    super(input.message);
    this.name = 'SyncError';
    this.code = input.code;
    this.diagnostics = input.diagnostics;
    this.status = input.status;
  }
}
export function fail(code: string): never {
  throw new SyncError({ code, message: code.replaceAll('_', ' ') });
}
