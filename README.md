<div align="center">
  <h1><img src="apps/web/frontend/src/assets/open-sync.svg" alt="" width="32" height="32" align="absmiddle" /> Open Sync</h1>
  <p><em>Data sync from any source to any destination.</em></p>
  <img src=".github/assets/open-sync-logo.gif" alt="Open Sync's two arrows illuminated by moving warm light" width="640" height="360" />
</div>

Use the included dashboard or embed the headless engine in your own Bun app. Open Sync handles
provider connections, incremental syncing, retries, and delivery of records and assets.

## Deploy on nibrun

[![Deploy on nibrun](.github/assets/deploy-on-nibrun.svg)](https://app.nibrun.com/deploy?name=open-sync&binary=https%3A%2F%2Fgithub.com%2Fmassimoalbarello%2Fopen-sync%2Freleases%2Fdownload%2Fnibrun-latest%2Fopen-sync&port=3000&minimal)

Click the button, sign in to nibrun, and deploy. Open your instance's URL, create an account,
and connect your providers.

To update an existing instance, complete the local setup below, then install the nibrun CLI and sign in:

```sh
curl -fsSL https://nibrun.com/install.sh | sh
nib login
bun run deploy --app YOUR_APP_SLUG
```

Replace `YOUR_APP_SLUG` with the slug from `nib apps list`. The command builds and deploys the update.

## Run locally

Clone this repository and install Bun 1.4 and Node 24, then:

```sh
bun install --frozen-lockfile
bun run dev
```

Open [localhost:5173](http://localhost:5173) and create an account.

## Use the headless engine

Headless means the same sync engine, without the dashboard. It runs inside your Bun server;
your app keeps its own UI, login, and user permissions.

```sh
bun add @context-use/open-sync
```

1. Call `await createOpenSync()` with a data directory, your source definitions and destination handlers,
   and your app's authorization functions.
2. Route requests to `sync.fetch(request)` and set `publicUrl` to that route's full URL
   (for example, `https://your-app.com/api/open-sync`). This includes provider authorization callbacks.
3. Call `sync.start()` when your server starts and `await sync.close()` when it shuts down.
   Use `sync.providers` to manage connections and `sync.api` to manage syncs.

See the [working host integration](apps/web/backend/src/main.ts),
[configuration options](packages/sync/src/open-sync.ts), and
[source and destination examples](examples/integrations/src).

[MIT license](LICENSE).
