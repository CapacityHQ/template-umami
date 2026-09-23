# Development, Build, Testing, and Deployment

Facts below are taken from the repo's config files (cited inline). Repo root: the directory containing `package.json`.

## Toolchain

| Requirement | Value | Source |
| --- | --- | --- |
| Node | `>=22` (verified local: v22.22.3) | `package.json` `engines` |
| Package manager | pnpm (lockfile `pnpm-lock.yaml`, verified local: 10.34.5). Docker pins `PNPM_VERSION=11.21.0` | `Dockerfile` |
| Postgres | `>=9.4.0` enforced at startup; README recommends v12.14+ | `scripts/check-db.js` (`MIN_VERSION`) |
| Biome | 2.5.5 (`biome.json` declares schema 2.3.6 — harmless version-mismatch info) | `package.json`, `biome.json` |

There is **no `packageManager` field** and **no `.github/workflows`** in this repo — `.github/` only holds issue templates. CI gates come from `CONTRIBUTING.md`, not from GitHub Actions config present here.

## Quickstart

```bash
git clone <repo> && cd template-umami
pnpm install

# 1. Postgres for local dev (matches the DATABASE_URL in .env.example)
docker compose -f .capacity/compose.services.yaml up -d --wait   # postgres:16 on :5432, user/pass/db = umami

# 2. Env
cp .env.example .env            # DATABASE_URL=postgresql://umami:umami@localhost:5432/umami

# 3. Generate Prisma client + run migrations (creates tables, seeds admin/umami login)
pnpm build-db && pnpm check-db

# 4. Tracker + session recorder bundles into public/
pnpm build-tracker && pnpm build-recorder

# 5. Dev server -> http://localhost:3000   (default login: admin / umami)
pnpm dev
```

Steps 3–4 are exactly the setup commands Capacity Desktop runs (`.capacity/runtime.json` `setup[]`); the primary app command is `pnpm dev`.

Note: root `docker-compose.yml` runs the **published** image `ghcr.io/umami-software/umami:latest` + its own Postgres — it is a deployment recipe, not a dev-source stack. Use `.capacity/compose.services.yaml` for local development.

## npm scripts reference

Run with `pnpm <script>`.

| Script | Command | What it does |
| --- | --- | --- |
| `dev` | `dotenv next dev --turbo` | Dev server on :3000, `.env` loaded via dotenv-cli, Turbopack. |
| `build` | `npm-run-all check-env build-db check-db build-tracker build-recorder build-geo build-app` | Full production build (sequential — see chain below). |
| `start` | `next start` | Serve a built app. |
| `build-docker` | `npm-run-all build-db build-tracker build-recorder build-geo build-app` | Build inside image (skips `check-env`/`check-db`). |
| `start-docker` | `npm-run-all check-db update-tracker start-server` | Legacy container start; the image actually runs `scripts/start-docker.sh`. |
| `start-env` | `node scripts/start-env.js` | `next start` with `PORT`/`HOSTNAME` from env (defaults 3000 / 0.0.0.0). |
| `start-server` | `node server.js` | Runs the Next standalone server. |
| `build-app` | `next build --turbo` | Next production build (`output: 'standalone'` unless `VERCEL`). |
| `build-icons` | `svgr ./src/assets --out-dir src/components/svg --typescript` | Regenerate SVG React components. |
| `build-components` | `node scripts/bump-components.js && tsup` | Build the publishable `@umami/components` ESM bundle to `dist/`. |
| `build-tracker` | `check-tracker` → `build-tracker-script` → `build-tracker-types` | Typecheck, bundle, and emit `.d.ts` for the tracker. |
| `build-tracker-script` | `rollup -c rollup.tracker.config.js` | Emits `public/script.js`. |
| `build-tracker-types` | `tsc -p tsconfig.tracker.types.json && biome format --write src/tracker/index.d.ts` | Emits + formats tracker typings. |
| `check-tracker` | `tsc -p tsconfig.tracker.json --noEmit` | Strict typecheck of `src/tracker/**` (`strictNullChecks: true` there). |
| `build-recorder` | `rollup -c rollup.recorder.config.js` | Emits `public/recorder.js` (rrweb session recorder). |
| `build-prisma-client` | `node scripts/build-prisma-client.js` | esbuild-bundles `src/generated/prisma/client.ts` → `generated/prisma/client.js`. |
| `build-lang` | `download-country-names` + `download-language-names` | Refresh i18n name data. |
| `build-geo` | `node scripts/build-geo.js` | Downloads GeoLite2-City DB into `geo/`. **Needs network**; skipped if `SKIP_BUILD_GEO`, or on Vercel unless `BUILD_GEO`. |
| `build-db` | `build-db-client` + `build-prisma-client` | `prisma generate` then bundle the client. |
| `build-db-schema` | `prisma db pull` | Introspect DB into the schema. |
| `build-db-client` | `prisma generate` | Generates client into `src/generated/prisma`. |
| `update-tracker` | `node scripts/update-tracker.js` | Rewrites `/api/send` in `public/script.js` to `COLLECT_API_ENDPOINT`. |
| `update-db` | `prisma migrate deploy` | Apply migrations. |
| `check-db` | `node scripts/check-db.js` | Verifies `DATABASE_URL`, connection, server version ≥ 9.4, then runs `prisma migrate deploy` (unless `SKIP_DB_MIGRATION`). |
| `check-env` | `node scripts/check-env.js` | Fails the build if required env vars are missing. |
| `check-missing-messages` | `node scripts/check-missing-messages.js [--remove-extra-keys]` | Diffs locale files against `public/intl/messages/en-US.json`. |
| `seed-data` | `tsx scripts/seed-data.ts` | Seeds demo analytics data (refuses to run on Vercel/Netlify/Railway). |
| `test` | `vitest run` (with `pretest` = `pnpm build-db-client`) | Unit/component tests. |
| `test:watch` | `vitest` | Watch mode. |
| `test:e2e` | `playwright test` | End-to-end tests. |
| `test:e2e:ui` | `playwright test --ui` | Playwright UI mode. |
| `lint` | `biome lint .` | Lint only. |
| `format` | `biome format --write .` | Format in place. |
| `check` | `biome check --write` | Lint + format + import organization, writing fixes (defaults to cwd). |
| `postbuild` | `node scripts/postbuild.js` | Sends build telemetry unless `DISABLE_TELEMETRY`. Runs automatically after `build`. |

Broken references: `change-password` and `copy-db-files` point at `scripts/change-password.js` / `scripts/copy-db-files.js`, **which do not exist**. Do not rely on them.

### `build` chain (strictly sequential, `npm-run-all`)

```
check-env        # fail fast on missing env
  -> build-db    # build-db-client (prisma generate) -> build-prisma-client (esbuild)
  -> check-db    # connect, version check, prisma migrate deploy
  -> build-tracker   # check-tracker -> build-tracker-script -> build-tracker-types
  -> build-recorder
  -> build-geo   # network download
  -> build-app   # next build --turbo
  -> (postbuild) # telemetry, auto-run by npm lifecycle
```

`build` therefore **requires a reachable database** and network access.

## Environment variables

Loaded from `.env` (via `dotenv`/`dotenv-cli`). `.env.example` only lists three; everything else is discovered from `process.env.*` in `src/`, `scripts/`, and `next.config.ts`.

| Variable | Required | Purpose | Default |
| --- | --- | --- | --- |
| `DATABASE_URL` | **Yes** (unless `SKIP_DB_CHECK` or `DATABASE_TYPE` is set — `scripts/check-env.js`) | Postgres connection string | none |
| `APP_SECRET` | No | Signs sessions/share links; falls back to a hash of `DATABASE_URL` (`src/lib/crypto.ts`) | derived |
| `TWO_FACTOR_ENCRYPTION_KEY` | No | 64-hex-char key; 2FA is unavailable until set (`src/lib/two-factor/crypto.ts`) | unset |
| `DIRECT_DATABASE_URL` | No | Non-pooled URL used for `prisma migrate deploy` | `DATABASE_URL` |
| `DATABASE_REPLICA_URL` | No | Enables Prisma read-replica extension (`src/lib/prisma.ts`) | unset |
| `DATABASE_TYPE` | No | Overrides DB type detection; also suppresses the `DATABASE_URL` check | derived from URL |
| `CLICKHOUSE_URL` | No | Enables ClickHouse analytics backend (`src/lib/clickhouse.ts`) | unset |
| `REDIS_URL` | No | Enables Redis cache (`src/lib/redis.ts`) | unset |
| `KAFKA_URL`, `KAFKA_BROKER` | No | Both required together to enable Kafka ingest (`src/lib/kafka.ts`) | unset |
| `KAFKA_SASL_MECHANISM` | No | `plain` \| `scram-sha-256` \| `scram-sha-512` | `plain` |
| `KAFKA_SSL_ALLOW_UNAUTHORIZED` | No | `'true'` disables TLS cert verification | unset |
| `KAFKA_MAX_MESSAGE_BYTES` | No | Producer message size cap | Kafka default |
| `CLOUD_MODE`, `CLOUD_URL` | No | Umami Cloud mode. If `CLOUD_URL` is set, `CLOUD_URL`+`CLICKHOUSE_URL`+`REDIS_URL` all become required (`scripts/check-env.js`) | unset |
| `API_URL` | No | Base path/URL for internal UI API calls; relative values get a rewrite in `next.config.ts` | `''` |
| `BASE_PATH` | No | Next `basePath` for sub-path hosting | `''` |
| `COLLECT_API_ENDPOINT` | No | Custom `/api/send` path; rewritten into the tracker | `/api/send` |
| `COLLECT_API_HOST` | No | Tracker's absolute collect host (rollup replace) | `''` |
| `TRACKER_SCRIPT_NAME` | No | Comma-separated alternate names rewritten to `/script.js` | unset |
| `TRACKER_SCRIPT_URL` | No | Rewrite `/script.js` to an external URL | unset |
| `CORS_MAX_AGE` | No | `Access-Control-Max-Age` on API routes | `86400` |
| `FORCE_SSL` | No | Adds HSTS header | unset |
| `ALLOWED_FRAME_URLS` | No | Extra CSP `frame-ancestors` (`src/lib/csp.ts`) | `'self'` |
| `DEFAULT_LOCALE`, `DEFAULT_CURRENCY` | No | UI defaults exposed via `next.config.ts` `env` | `''` |
| `FAVICON_URL`, `LINKS_URL`, `PIXELS_URL` | No | Returned by `/api/config` | unset |
| `PRIVATE_MODE` | No | Disables telemetry script and marks instance private | unset |
| `DISABLE_TELEMETRY` | No | Skips build + runtime telemetry | unset |
| `DISABLE_UPDATES` | No | Hides update notice | unset |
| `DISABLE_LOGIN` | No | 404s `/login`, `/login/two-factor`, `/logout` | unset |
| `DISABLE_UI` | No | Serves no UI (`src/app/layout.tsx`) | unset |
| `DISABLE_BOT_CHECK` | No | Skips `isbot` filtering in `/api/send` and `/api/record` | unset |
| `ENABLE_TEST_CONSOLE` | No | Enables `/console/[websiteId]` test page | unset |
| `IGNORE_IP` | No | Comma list of IPs to drop | unset |
| `CLIENT_IP_HEADER` | No | Extra header to read the client IP from (`src/lib/ip.ts`) | unset |
| `SKIP_LOCATION_HEADERS` | No | Ignore CDN geo headers, use MaxMind only | unset |
| `GEOLITE_DB_PATH` | No | Path to `GeoLite2-City.mmdb` | `<cwd>/geo/GeoLite2-City.mmdb` |
| `GEO_DATABASE_URL`, `MAXMIND_LICENSE_KEY` | No | Custom geo DB source for `build-geo` | public redist tarball |
| `BUILD_GEO`, `SKIP_BUILD_GEO` | No | Force/skip the geo download | unset |
| `SALT_ROTATION` | No | Session salt rotation period (`/api/send`) | `month` |
| `REMOVE_TRAILING_SLASH` | No | Normalizes collected URLs | unset |
| `USE_UUIDV7` | No | Generate UUID v7 instead of v4 | v4 |
| `UMAMI_SELF_TRACK`, `UMAMI_SELF_RECORD` | No | Website IDs for self-tracking/self-recording | unset |
| `LOG_QUERY` | No | Logs Prisma/ClickHouse queries | unset |
| `SKIP_DB_CHECK`, `SKIP_DB_MIGRATION` | No | Skip `check-db` entirely / skip the migrate step | unset |
| `PORT`, `HOSTNAME` | No | Used by `scripts/start-env.js` and Playwright's base URL | `3000`, `0.0.0.0` |
| `PLAYWRIGHT_BASE_URL`, `PLAYWRIGHT_SKIP_WEB_SERVER`, `PLAYWRIGHT_WEB_SERVER_COMMAND` | No | E2E overrides (`playwright.config.ts`) | `http://localhost:$PORT`, unset, `pnpm dev` |
| `UMAMI_USER`, `UMAMI_PASSWORD`, `UMAMI_USER_ID` | No | E2E login credentials (`tests/e2e/helpers.ts`) | `admin`, `umami`, fixed UUID |
| `CI`, `VERCEL`, `NETLIFY`, `RAILWAY_ENVIRONMENT` | No | Platform detection (retries, geo skip, seed guard) | unset |

Client-visible values are re-exported lowercase through `next.config.ts` `env`: `process.env.apiUrl`, `basePath`, `cloudMode`, `cloudUrl`, `currentVersion`, `defaultCurrency`, `defaultLocale`, `selfTrack`, `selfRecord`. Use those lowercase names in client components; the uppercase ones are server-only.

## Path aliases

| Alias | Resolves to | Configured in |
| --- | --- | --- |
| `@/*` | `./src/*` | `tsconfig.json` `paths` |
| `@` | `./src` | `vitest.config.ts` `resolve.alias` |

This is the only alias. Always import app code as `@/lib/...`, `@/components/...`, `@/app/...` (768 files already do). Deep relative imports like `../../../lib/x` are not used in `src/`.

## TypeScript rules to respect

- `strict: true` but `strictNullChecks: false` and `noImplicitAny: false` in `tsconfig.json` — do not "fix" null handling by adding non-null assertions; `noNonNullAssertion` is a lint warning.
- `isolatedModules: true` → use `import type { X }` for type-only imports (`useImportType` is linted).
- `noEmit: true`; JSX runtime is `react-jsx` (no `import React` needed).
- `src/tracker/**` is typechecked separately with `strict` + `strictNullChecks: true` (`tsconfig.tracker.json`) — that code must be null-safe.
- `next.config.ts` sets `typescript.ignoreBuildErrors: true`, so **`pnpm build` will not catch type errors**. Run `pnpm exec tsc --noEmit` yourself (it currently passes clean).
- `tsconfig.json` excludes `tests/e2e` and `playwright.config.ts` from the main typecheck.

## Code style (from `biome.json`)

- Line width **100**, 2-space indent, LF line endings.
- **Single quotes** in JS/TS; trailing commas **everywhere** (`all`).
- Arrow parentheses **as needed**: `name => ...`, not `(name) => ...`.
- Semicolons: Biome default (`always`) — keep them.
- Imports are auto-organized (`assist.source.organizeImports: "on"`); let `pnpm check` sort them rather than hand-ordering.
- Use `node:` protocol for Node builtins (`useNodejsImportProtocol` is on).
- Rules deliberately **off** — do not add churn for these: a11y (entire group), `useExhaustiveDependencies`, `noDescendingSpecificity`, `noImportantStyles`, `noArrayIndexKey`, `noExplicitAny`, `noImplicitAnyLet`, `noImgElement`.
- CSS is formatted by Biome too (2-space, LF). `.gitignore` is honored (`vcs.useIgnoreFile: true`); `**/dist` is excluded.

## Testing

Unit/component tests — Vitest, `jsdom`, include glob `src/**/*.test.{ts,tsx}`, setup `src/test/setup.ts` (`vitest.config.ts`).

```bash
pnpm test                              # all unit tests (pretest runs prisma generate)
pnpm test src/lib/sort.test.ts         # one file
pnpm test -- -t "sorts by name"        # one test by name
pnpm test:watch                        # watch mode
```

Conventions (`src/test/README.md`, enforced by habit not by lint):

- Co-locate tests as `*.test.ts(x)` next to the source — they live in `src/lib/`, `src/store/`, `src/permissions/`, and a few in `src/app/`.
- Import Vitest APIs explicitly; use `test`, not `it`.
- React component tests import `render` from `@/test/render` (wraps ZenProvider, RouterProvider, NextIntl with `en-US`, and a React Query client). `@/test/test-utils` is a thinner re-export of Testing Library.
- Test id attribute is `data-test` (configured in both `src/test/setup.ts` and `playwright.config.ts`). Prefer role/label/text queries.
- `src/test/setup.ts` stubs `matchMedia`, `clipboard`, `scrollTo`, `ResizeObserver`, `IntersectionObserver`, and runs `cleanup()` + `vi.restoreAllMocks()` after each test.
- MSW is installed and wired (`src/test/msw/server.ts`), but `handlers` is an **empty array** and no test imports it yet. Add handlers there if you need HTTP mocking.

E2E — Playwright, `tests/e2e/**`, chromium only, `fullyParallel: false` (`playwright.config.ts`).

```bash
pnpm test:e2e                          # auto-starts `pnpm dev` unless PLAYWRIGHT_SKIP_WEB_SERVER=1
pnpm test:e2e tests/e2e/login.spec.ts  # one spec
pnpm test:e2e -- -g "login"            # by title
pnpm test:e2e:ui                       # UI mode
```

E2E needs a migrated DB with the default `admin`/`umami` user (`tests/e2e/helpers.ts`). Under `CI=1`: 2 retries, 1 worker, `forbidOnly`, html reporter.

## Before you claim done

1. `pnpm exec tsc --noEmit` — must be clean (it is today).
2. `pnpm test` — all unit tests pass.
3. `pnpm lint` — **note: this already exits non-zero on a clean checkout** (~13 warnings in files such as `src/components/charts/DistributionBarChart.tsx`, `scripts/seed-data.ts`, `scripts/build-geo.js`, plus two `biome.json` schema/deprecation infos). Verify *your* files produce no new diagnostics: `pnpm exec biome check <changed-paths>`.
4. `pnpm exec biome check --write <changed-paths>` to apply formatting + import order before committing.
5. `pnpm test:e2e` when touching auth, websites, teams, or user flows.
6. `pnpm build` only when you changed the build chain, Prisma schema, tracker, or recorder — it needs a live DB and network.

`CONTRIBUTING.md` gate: PRs must target **`dev`**, never `master`; it asks for `pnpm install && pnpm build && pnpm lint` to be clean and one logical change per PR.

## Deployment targets

| Target | Files | Notes |
| --- | --- | --- |
| Docker image | `Dockerfile`, `scripts/start-docker.sh`, `.dockerignore` | 3-stage build on `node:22-alpine`; builds with `npm run build-docker` and a dummy `DATABASE_URL`; final stage drops npm, installs only prisma/runtime script deps, runs as `nextjs` (uid 1001) on port 3000. Entry: `check-db.js` → `update-tracker.js` → `exec node server.js`. |
| Docker Compose | `docker-compose.yml` | `ghcr.io/umami-software/umami:latest` + `postgres:15-alpine`, healthcheck `GET /api/heartbeat`. Replace `APP_SECRET` and `TWO_FACTOR_ENCRYPTION_KEY` placeholders. |
| Podman | `podman/podman-compose.yml`, `podman/env.sample`, `podman/umami.service`, `podman/install-systemd-user-service` | podman 4.3+; optional systemd user service. |
| Netlify | `netlify.toml` | `@netlify/plugin-nextjs`; bundles `node_modules/.geo/**` into functions. |
| Vercel | `next.config.ts`, `scripts/build-geo.js` | Detected via `VERCEL`; disables `output: 'standalone'` and skips the geo download unless `BUILD_GEO`. |
| Heroku | `app.json` | Adds `heroku-postgresql`; requires generated `APP_SECRET`. |
| Capacity Desktop | `.capacity/runtime.json`, `.capacity/compose.services.yaml` | Local dev orchestration: postgres:16 service + setup commands + `pnpm dev`. |
