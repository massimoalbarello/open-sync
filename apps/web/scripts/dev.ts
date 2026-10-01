// Vite owns the frontend during development. Pointing the backend at a deliberately absent folder
// prevents an old production build in `public` from exposing a second, stale application origin.
const DEV_PUBLIC_FRONTEND_DIR_NAME = '.frontend-served-by-vite';

const proc = Bun.spawn(
  [
    'bun',
    'run',
    // Ties the server's lifetime to this wrapper: Ctrl-C or a killed parent takes the
    // server down with it instead of leaving :3000 held by an orphan.
    '--no-orphans',
    '--define',
    `PUBLIC_FRONTEND_DIR_NAME="${DEV_PUBLIC_FRONTEND_DIR_NAME}"`,
    '--define',
    'DB_MIGRATIONS_DIR_NAME="migrations"',
    'backend/src/main.ts',
  ],
  // stdio is inherited so the child keeps the terminal (TTY) and its output stays colored
  {
    stdio: ['inherit', 'inherit', 'inherit'],
    // Development must not install persistent jobs into the developer's own crontab.
    env: { ...process.env, SYNC_SCHEDULER: process.env.SYNC_SCHEDULER ?? 'timer' },
  },
);

process.exit(await proc.exited);
