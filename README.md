<div align="center">
  <h1><img src="apps/web/frontend/src/assets/open-sync.svg" alt="" width="32" height="32" align="absmiddle" /> Open Sync</h1>
  <p><em>Data sync from any source to any destination.</em></p>
  <img src=".github/assets/open-sync-logo.gif" alt="Open Sync's two arrows illuminated by moving warm light" width="640" height="360" />
</div>

Open Sync provides a headless Bun sync engine and a default web host with separate Providers,
Syncs and Delivery queue sections. The host uses Elysia, Better Auth passkeys, React and TanStack Router/Query.

[![Deploy on nibrun](.github/assets/deploy-on-nibrun.svg)](https://app.nibrun.com/deploy?name=open-sync&binary=https%3A%2F%2Fgithub.com%2Fmassimoalbarello%2Fopen-sync%2Freleases%2Fdownload%2Fnibrun-latest%2Fopen-sync&port=3000&minimal)

## Run locally

Requires Bun 1.4 and Node 24. Start locally with:

```sh
bun install --frozen-lockfile
bunx playwright install chromium
bun run dev
```

Open http://localhost:5173 and register the instance owner with a passkey. Further registration is closed once the owner is created. Passkeys require localhost or HTTPS.

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

`@context-use/open-sync` in `packages/sync` accepts trusted definitions and destination handlers through
`createOpenSync()`. The host mounts `fetch()`, supplies its authorization policy, and calls
`start()` and `close()`. Open Sync completes provider authorization before redirecting to the host UI.
The default app imports its GitHub definition from `@open-sync/examples` and delivers
records to its own idempotent SQLite receiver. The independent package consumer in
`packages/sync/test/package-consumer.ts` exercises embedding from an installed tarball.

This first version delivers records only. Assets, snapshot deletion, dry runs,
in-place definition upgrades and uploaded code execution are not implemented yet. Definitions
and destinations are pinned to immutable versions; reprocessing resets the checkpoint but retains
record hashes. Trusted functions must honor cancellation. User-uploaded code will need isolation
and resource limits before it can be executed.

Open Sync uses `@oomol-lab/open-connector@1.6.0` internally for provider authentication and requests.
Connector storage is opaque, and hosts use Open Sync connection references. Reauthorizing an account preserves its connection reference and existing syncs.

## Deploy on nibrun

Use the button above to create your own instance without building locally. It opens nibrun with
the app name, port, and latest tested Linux binary already selected. Sign in to nibrun, deploy,
then open your instance's HTTPS URL and register the first passkey to become its owner.
Configure your providers from the dashboard after setup.

The [rolling nibrun release](https://github.com/massimoalbarello/open-sync/releases/tag/nibrun-latest)
contains the `open-sync` Linux x86_64 binary and its SHA-256 checksum. The build workflow refreshes
it after the compiled-binary and browser checks pass on `main`; it is separate from npm package
releases. The binary embeds the dashboard, provider definitions, and database migrations.

To build and deploy from a local checkout, install the nibrun CLI and sign in once:

```sh
curl -fsSL https://nibrun.com/install.sh | sh
nib login
bun run deploy --new open-sync
```

The deploy command builds for Linux automatically. To update the same instance:

```sh
nib apps list
bun run deploy --app open-sync
```

Use an exact slug from `nib apps list` if multiple instances share that name. `--app` updates an
existing instance and never silently creates another; `--new` creates a separate instance.
To build without deploying, run `bun run build:linux`; the output is `apps/web/dist/app`.

nibrun supplies `PORT` and `NIBRUN_HOSTNAME`, so no environment variables are required for first
boot. Open Sync derives its public HTTPS origin from that hostname and keeps its databases,
assets, provider credentials, and generated authentication secret under `/app/data`. This storage
survives restarts and redeployments. For a custom domain, set `BASE_URL` to its HTTPS origin.
Redeployments briefly stop the old instance; use `nib apps export` to back up its persistent data.
