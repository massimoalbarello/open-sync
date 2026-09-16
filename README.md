# Bun full-stack template

A working full-stack application and an engineering workflow for building the next one.
Use GitHub’s **Use this template → Create a new repository**, then clone your new repository.
Requires Bun 1.4.0 and Node 24 (for architecture and frontend lint tools).

```sh
bun install --frozen-lockfile
bunx playwright install chromium
bun run dev
```

Open http://localhost:5173 and create an account with a passkey. Each account has private notes.
Passkeys require localhost or HTTPS. Registration is open; decide your product’s onboarding policy
before exposing a deployment. Accounts have no password or email recovery flow.

## Opinionated stack

These are the defaults for applications built from this template. Extend the existing owner of a
responsibility before introducing another framework; discuss a replacement when a concrete product
requirement cannot fit the established approach. Package manifests and `bun.lock` own the versions.

### Runtime and backend

| Framework or tool | What we use it for |
| --- | --- |
| [Bun](https://bun.com/) | Application runtime, workspace package management, scripts, tests, SQL access, and compilation into one executable. |
| [TypeScript](https://www.typescriptlang.org/) | Strict static typing across the backend, frontend, shared packages, and scripts. |
| [Node.js](https://nodejs.org/) | Runs the frontend ESLint and backend dependency checks during development and CI. |
| [Elysia](https://elysiajs.com/) | HTTP routing, request and response schemas, boundary validation, and application composition. |
| [Eden](https://elysiajs.com/eden/overview) | Gives frontend API calls types derived directly from the Elysia application. |
| [Elysia OpenAPI](https://elysiajs.com/plugins/openapi) | Generates the API specification and interactive documentation from route schemas. |
| [Better Auth](https://www.better-auth.com/) and its [passkey plugin](https://www.better-auth.com/docs/plugins/passkey) | Account registration, WebAuthn passkey sign-in, and cookie sessions. |
| [SQLite](https://sqlite.org/) through [Bun SQL](https://bun.com/docs/runtime/sql) | Stores application and authentication data in a local persistent database, with SQL migrations. |
| [bun-sqlgen](https://github.com/ilbertt/bun-sqlgen) | Generates repository query result types from SQL and migrations; CI detects generated-type drift. |
| [better-auth-bun-sql](https://github.com/ilbertt/better-auth-bun-sql) | Connects Better Auth to the application's Bun SQL database. |

### Frontend and design system

| Framework or library | What we use it for |
| --- | --- |
| [React](https://react.dev/) and React DOM | Render the interface and manage transient component state. |
| [Vite](https://vite.dev/) | Serves the frontend in development, proxies backend requests, and builds production assets. |
| [TanStack Router](https://tanstack.com/router) | Owns file-based routes, navigation, guards, loaders, and typed URL state. |
| [TanStack Query](https://tanstack.com/query) | Owns server data, query keys, caching, mutations, and invalidation. |
| [TanStack Form](https://tanstack.com/form) | Owns form values, field validation, submission, and pending state. |
| [Tailwind CSS](https://tailwindcss.com/) | Styles layouts and components with utilities backed by shared semantic theme tokens. |
| [Base UI](https://base-ui.com/) | Provides accessible interaction primitives, including buttons and inputs. |
| [shadcn/ui](https://ui.shadcn.com/) | Supplies the source-owned component conventions used by our shared Base UI primitives. |
| [Class Variance Authority](https://cva.style/) | Defines typed component variants, such as button size and appearance. |
| [clsx](https://github.com/lukeed/clsx) and [tailwind-merge](https://github.com/dcastil/tailwind-merge) | Compose conditional classes and resolve conflicting Tailwind utilities in the shared `cn` helper. |
| [Fontsource](https://fontsource.org/) | Bundles DM Sans and Geist Mono locally with the frontend. |
| [tweakcn](https://tweakcn.com/) | Provides the Minimal Neutral theme whose tokens are checked into `packages/ui`. |

[Zod](https://zod.dev/) is also included as an available schema-validation library, but the starter
does not currently import it. Backend request validation uses Elysia schemas; add client schemas
only for a concrete form or URL boundary, following the [frontend guide](apps/web/frontend/AGENTS.md).

### Testing, guardrails, and delivery

| Tool | What we use it for |
| --- | --- |
| [Bun test](https://bun.com/docs/test) | Runs backend integration tests, frontend component tests, deployment tests, and compiled-binary checks. |
| [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/) and [user-event](https://testing-library.com/docs/user-event/intro/) | Test accessible component behavior through roles, labels, and realistic user interactions. |
| [Happy DOM](https://github.com/capricorn86/happy-dom) | Supplies the DOM environment for component tests running in Bun. |
| [Playwright](https://playwright.dev/) | Exercises real browser journeys and passkey ceremonies with disposable virtual authenticators. |
| [Biome](https://biomejs.dev/) | Formats code and enforces general code-quality rules across the repository. |
| [ESLint](https://eslint.org/), [TanStack Query rules](https://tanstack.com/query/latest/docs/eslint/eslint-plugin-query), and [shadcn lint](https://github.com/shadcn-ui/lint) | Enforce frontend query correctness and shared design-system conventions. |
| [dependency-cruiser](https://github.com/sverweij/dependency-cruiser) | Enforces backend layer boundaries and permitted dependency directions. |
| [commitlint](https://commitlint.js.org/) and [Conventional Commits](https://www.conventionalcommits.org/) | Validate the commit and PR-title convention used by the delivery workflow. |
| [Turborepo](https://turborepo.dev/) | Coordinates workspace tasks, dependency ordering, and caching. |
| [GitHub Actions](https://docs.github.com/en/actions) | Runs CI checks, builds and verifies the Linux binary, and uploads build and browser artifacts. |
| [nibrun](https://nibrun.com/) | Hosts the compiled application binary with HTTPS and persistent storage through the `nib` deployment CLI. |

## Structure

- `apps/web/backend`: Elysia, Eden types, Better Auth passkeys, Bun SQL/SQLite, generated SQL types.
  Models own domain rules, repositories own persistence, services own workflows, routes own transport.
- `apps/web/frontend`: React, Vite, TanStack Router/Query/Form, Tailwind, Base UI/shadcn primitives.
- `packages/ui`: shared primitives and semantic theme; `packages/typescript-config`: strict TypeScript.
- `packages/build-tools`: binary verification and explicit nibrun deployment targeting.
- `packages/browser-testing`: ephemeral virtual authenticators for real WebAuthn browser tests.
- `AGENTS.md` and scoped guides: engineering judgment, ownership, trust, tests, and UI contracts.
- `.agents/skills`: feature delivery, pull request creation, and nibrun deployment workflows.

The notes example demonstrates the complete vertical slice. Replace it with your product’s domain;
retain the ownership, validation, query, authentication, and accessibility boundaries.

## Development and verification

```sh
bun run dev:isolated:seeded  # disposable database, real passkey signup, seeded through the UI
bun run fix:codestyle
bun run check:all
bun run test
bun run test:browser
bun run build              # executable for this machine
bun run test:binary
```

`dev:isolated` opens an unseeded browser. Both isolated modes use separate ports and temporary data,
and remove only their own data on shutdown. Browser checks cover registration, sign-in, session
changes, notes, and cross-account access. Screenshots go to ignored `artifacts/`.

After editing schema or repository SQL, run `bun --filter @repo/web generate:queries` and commit the
updated generated file. CI checks generation drift, types, formatting, frontend conventions,
backend dependency boundaries, tests, compiled Linux behavior, and the real browser journey.

## Deploy to nibrun

Install the `nib` CLI using https://nibrun.com/install.sh and run `nib login` yourself. Then:

```sh
bun run deploy --new my-app
bun run deploy --app exact-existing-slug
```

The deploy command builds for Linux x64 and embeds the frontend and SQL migrations into
`apps/web/dist/app`. `bun run build:linux` produces the same binary without deploying it.
CI uploads the verified executable as `nibrun-binary`; no deployment credentials are required in CI.

The server honors `PORT`, listens on `0.0.0.0`, derives HTTPS origin from `NIBRUN_HOSTNAME`, and stores
SQLite and its generated private auth secret inside `/app/data`. Optional `BASE_URL` supports a
custom domain; keep the original nibrun hostname stable for existing passkeys. `DATA_FOLDER` and
`BETTER_AUTH_SECRET` can be overridden. Local defaults need no `.env` file; see `apps/web/.env.example`.

nibrun is a single VM with local persistent storage. Redeployments briefly interrupt service. Export
and verify backups before changes to persistent data; exporting is not an automatic backup schedule.
Follow [the deployment skill](.agents/skills/deploy-to-nibrun/SKILL.md) and [compatibility policy](COMPATIBILITY.md).

## Evolving the template

Use [ship-change](.agents/skills/ship-change/SKILL.md) for feature work and
[open-pull-request](.agents/skills/open-pull-request/SKILL.md) for reviewed Conventional Commit PRs.
The bootstrap application is deliberately generic; do not add a product’s integrations to the template
unless they represent a demonstrated reusable need. Preserve new lessons as executable checks where
possible and scoped guidance only when judgment is required.

Template generation copies a snapshot. Updates here do not automatically update repositories already
created from it. Adopt later improvements through focused PRs in each consuming repository, reviewing
its deployed data and local decisions. Do not overwrite a consumer’s engineering guides blindly.

Configure GitHub rulesets to require `checks:required`, `build:required`, `browser:required`, and
`check-pr-title:required` before merging, when supported by the repository’s account plan. Rulesets,
secrets, and environments are GitHub settings and are not copied by Use this template.
