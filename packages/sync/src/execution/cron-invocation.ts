import requestCron from './cron-client';

const TITLE_PREFIX = 'open-sync-';

/** Handle Bun's compiled cron invocation before loading application configuration or services. */
export async function runOpenSyncCron(): Promise<boolean> {
  const argument = process.argv.find((value) => value.startsWith(`--cron-title=${TITLE_PREFIX}`));
  if (!argument) {
    return false;
  }
  const encoded = argument.slice(`--cron-title=${TITLE_PREFIX}`.length);
  const socket = Buffer.from(encoded, 'base64url').toString();
  if (!socket.startsWith('/') || Buffer.from(socket).toString('base64url') !== encoded) {
    throw new Error('Invalid Open Sync cron invocation.');
  }
  await requestCron(socket);
  return true;
}

export function cronTitle(socket: string): string {
  // The command must find its worker even when Unix cron supplies a different cwd/environment.
  return `${TITLE_PREFIX}${Buffer.from(socket).toString('base64url')}`;
}
