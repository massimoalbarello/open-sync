# Open Sync

Open Sync provides a headless Bun sync engine and a default web host with separate Providers,
Syncs and Delivery queue sections. The host uses Elysia, Better Auth passkeys, React and TanStack Router/Query.

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
bun run check:package
bun run build
bun run test:binary
```

Isolated development uses disposable storage and real passkey registration.
Browser screenshots are written to the ignored `artifacts/` directory.

Engineering guidance starts in [AGENTS.md](AGENTS.md). The application lives in `apps/web`;
shared primitives, build tools and browser test support live in `packages`.
The host owns HTTP routing, user authentication, configuration and lifecycle.

`@open-sync/core` in `packages/sync` accepts trusted definitions and destination handlers through
`createOpenSync()`. The host mounts `fetch()`, supplies its authorization policy, and calls
`start()` and `close()`. Open Sync completes provider authorization before redirecting to the host UI.
The default app imports its GitHub and sample definitions from `@open-sync/examples` and delivers
records to its own idempotent SQLite receiver. The independent package consumer in
`packages/sync/test/package-consumer.ts` exercises embedding from an installed tarball.

This first version delivers records only. Assets, snapshot deletion, dry runs,
in-place definition upgrades and uploaded code execution are not implemented yet. Definitions
and destinations are pinned to immutable versions; reprocessing resets the checkpoint but retains
record hashes. Trusted functions must honor cancellation. User-uploaded code will need isolation
and resource limits before it can be executed.

Open Sync uses `@oomol-lab/open-connector@1.6.0` internally for provider authentication and requests.
Connector storage is opaque, and hosts use Open Sync connection references. Reconnecting existing
installations is not implemented; a new connection requires a new installation.
