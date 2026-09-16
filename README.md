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
`createSyncRuntime()`. The host calls `start()` and `close()`, or `tick()` for an explicit pump.
Management HTTP routes are optional; the typed API works without a listener. The default app's
sample definition and idempotent local receiver live outside the core. The independent package
consumer in `packages/sync/test/package-consumer.ts` exercises embedding from an installed tarball.

This first version delivers records only. Assets, snapshot deletion, dry runs,
in-place definition upgrades and uploaded code execution are not implemented yet. Definitions
and destinations are pinned to immutable versions; reprocessing resets the checkpoint but retains
record hashes. Trusted functions must honor cancellation. User-uploaded code will need isolation
and resource limits before it can be executed.

The Connector adapter uses public APIs verified against `@oomol-lab/open-connector@1.6.0`.
Hosts authorize connection references and serialize connection creation, resumption and credential
changes, suspending affected syncs before a change. Reconnection or account changes require a new
installation unless the host independently verifies that the stable source is unchanged.
Connector does not currently provide an atomic credential-generation check across its database
and Open Sync's database; changes made outside that host barrier cannot be fenced by this adapter.
