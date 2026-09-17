export class SyncError extends Error {
  readonly code: string;
  constructor(input: { code: string; message: string }) {
    super(input.message);
    this.name = 'SyncError';
    this.code = input.code;
  }
}
export function fail(code: string): never {
  throw new SyncError({ code, message: code.replaceAll('_', ' ') });
}
