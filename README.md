# Open Sync

The default web host for Open Sync, with an authenticated dashboard for providers, syncs and delivery.
The application uses Bun, Elysia, Better Auth passkeys, React and TanStack Router/Query.

Requires Bun 1.4 and Node 24. Start locally with:

```sh
bun install --frozen-lockfile
bunx playwright install chromium
bun run dev
```

Open http://localhost:5173 and create an account with a passkey. Registration is open;
choose an onboarding policy before exposing a deployment. Passkeys require localhost or HTTPS.

```sh
bun run dev:isolated:seeded
bun run check:all
bun run test
bun run test:browser
bun run build
bun run test:binary
```

Isolated development uses disposable storage and real passkey registration.
Browser screenshots are written to the ignored `artifacts/` directory.

Engineering guidance starts in [AGENTS.md](AGENTS.md). The application lives in `apps/web`;
shared primitives, build tools and browser test support live in `packages`.
The host owns HTTP routing, user authentication, configuration and lifecycle.
