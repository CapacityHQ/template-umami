# CLAUDE.md

Guidance for AI agents working in this repository.

## What this is

Umami — a privacy-first, cookie-less web analytics platform. One Next.js 16 (App Router)
deployment serves three things: the dashboard UI, the tracker collection endpoints, and a
JSON REST API. Data lives in Postgres (always) with optional ClickHouse, Redis, and Kafka.

**Upstream product documentation: https://docs.umami.is/docs** — read it for product
behavior, self-hosting, the tracker's public API, and the REST API contract. This repo's
`docs/` covers how *this codebase* is built; docs.umami.is covers what Umami *does*.

## Repo documentation

Read the relevant file before making changes in that area:

| File | Covers |
| --- | --- |
| `docs/architecture.md` | Route groups, URL map, request lifecycle, page/API conventions |
| `docs/api-and-auth.md` | All 127 API routes, handler anatomy, auth flows, roles/permissions, zod validation |
| `docs/data-layer.md` | Prisma models, ClickHouse schema, the dual-query pattern, Redis/Kafka, migrations |
| `docs/frontend.md` | Component map, `@umami/react-zen`, zustand stores, hooks reference, i18n |
| `docs/tracker-and-ingestion.md` | Tracker script, `data-*` attributes, build pipeline, end-to-end ingestion, recorder |
| `docs/development.md` | Scripts, env vars, testing, code style, CI, deployment targets |

## Quickstart

```bash
pnpm install
docker compose -f .capacity/compose.services.yaml up -d   # local Postgres
cp .env.example .env
pnpm build-db && pnpm check-db                            # generate client, migrate, seed admin
pnpm build-tracker && pnpm build-recorder                 # required: public/script.js is gitignored
pnpm dev
```

Default login is `admin` / `umami`. Node >= 22, pnpm.

## Conventions

**Imports** — the only path alias is `@/*` → `./src/*`. Use it; don't write deep relative paths.

**Pages** — `page.tsx` is a thin anonymous-default server component that delegates to a
colocated `'use client'` `XxxPage.tsx`. There are no server actions anywhere in this codebase;
all data loading is client-side via TanStack Query against the Bearer-token API.
Exemplar: `src/app/(main)/(reports)/funnels/page.tsx`.

**API routes** — every handler follows the same five steps: `parseRequest` → `if (error) return
error()` (it's a thunk — call it) → `await params` → a `can*()` permission check → `json()`.
Exemplar: `src/app/api/websites/[websiteId]/metrics/route.ts`.

**Queries** — config CRUD goes in `src/queries/prisma/**`; analytics queries go in
`src/queries/sql/**` and must implement *both* `relationalQuery` and `clickhouseQuery` behind
`runQuery` from `src/lib/db.ts`. Register new modules in the barrel index.

**UI** — prefer `@umami/react-zen` primitives (`Column`, `Row`, `Text`, `Button`, `Icon`) over
hand-rolled markup and CSS. Only 11 `*.module.css` files exist repo-wide; zen props are the
default styling mechanism. Note zen uses `onPress`, not `onClick`.

**Strings** — no hardcoded user-facing text. Add to `public/intl/messages/en-US.json`, alias in
`src/components/messages.ts`, use `t(labels.x)`, then run `pnpm check-missing-messages`.

**Style** — Biome, 100 columns, single quotes, trailing commas, `arrowParentheses: asNeeded`,
2-space indent. Run `pnpm format` (or `pnpm check`) rather than hand-formatting.

## Before claiming done

```bash
pnpm exec tsc --noEmit    # builds do NOT catch type errors: ignoreBuildErrors is true
pnpm test                 # vitest, co-located *.test.ts
pnpm lint                 # see caveat below
```

`pnpm lint` **already exits non-zero on a clean checkout** (1 error, 13 warnings as of this
writing). Compare against that baseline instead of treating a non-zero exit as your regression.

## Traps worth knowing

- `strictNullChecks` is `false` and `next.config.ts` sets `typescript.ignoreBuildErrors: true`
  — a green build proves nothing about types.
- `src/index.ts` is the entry point for the separate `@umami/components` package, not an app
  barrel. Don't import app code through it.
- Validation runs *before* auth in API handlers, so unauthenticated requests can get a 400.
- Share tokens are signed, not encrypted, and never expire; empty `parameters` means full access.
- `relationMode = "prisma"` means no database-level FK cascades — handle cleanup in code.
- Client-exposed env vars are mirrored in camelCase via the `next.config.ts` `env` allowlist.
- Files under `.capacity/` and any frontmatter key starting with `capacity_` are managed by
  Capacity tooling — never hand-edit them.
