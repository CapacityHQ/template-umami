# Architecture & Routing

## What this app is

Umami is a self-hostable web analytics product built as a single Next.js 16 App Router
application (`next: 16.3.0`, `react: ^19.2.8`, see `package.json:96`). One deployment serves
three concerns: the analytics **dashboard UI** (React client components), the **collection
endpoints** that the browser tracker posts to (`/api/send`, `/api/batch`, `/api/record`,
`/p/:slug`, `/q/:slug`), and a **JSON REST API** consumed by the UI itself over `fetch` with a
Bearer token. There is no server-side session: pages render as thin server shells and all data
loading happens client-side via TanStack Query. Data lives in Postgres/MySQL (Prisma,
`src/queries/prisma`) and optionally ClickHouse (`src/queries/sql`).

---

## Directory map

| Path | Purpose |
| --- | --- |
| `next.config.ts` | Headers (CSP/CORS), rewrites, redirects, `env` allowlist, `output: 'standalone'`. |
| `src/app/layout.tsx` | Root HTML shell, Inter font, favicons, `noindex` meta, `generateMetadata` using `getBaseUrl`. |
| `src/app/Providers.tsx` | `'use client'` — ZenProvider → RouterProvider → next-intl → QueryClientProvider → ErrorBoundary. |
| `src/app/page.tsx` | `'use client'` — `/` redirects to `/teams/<lastTeam>/websites` or `/websites`. |
| `src/app/not-found.tsx` | `'use client'` 404 page. |
| `src/app/(main)/` | Authenticated dashboard route group. `App.tsx` is the auth gate + chrome. |
| `src/app/(collect)/` | Two redirect/pixel collectors: `p/[slug]/route.ts` (tracking pixel GIF), `q/[slug]/route.ts` (short link redirect). |
| `src/app/api/` | 127 `route.ts` files across 20 top-level families. |
| `src/app/login/`, `logout/`, `sso/` | Unauthenticated auth pages (no `(main)` chrome). |
| `src/app/share/[slug]/[[...path]]/` | Public read-only share view, wrapped by `share/[slug]/layout.tsx` → `ShareProvider`. |
| `src/lib/` | Request/response/auth/crypto/date/schema helpers. The API's shared runtime. |
| `src/permissions/` | `can*` predicates (`canViewWebsite`, `canUpdateWebsite`, …), barrel at `src/permissions/index.ts`. |
| `src/queries/prisma/`, `src/queries/sql/` | Relational DB queries vs. analytics (ClickHouse/SQL) queries. |
| `src/components/hooks/` | `useApi`, `useNavigation`, `useLoginQuery`, `useMessages`, … |
| `src/store/` | Zustand stores: `app`, `cache`, `dashboard`, `version`, `websites`. |
| `src/lib/types.ts` | The real shared type module (`Auth`, `QueryFilters`, `PageResult<T>`, …). |
| `src/types/` | Only `react-zen.d.ts` — a module augmentation, not app types. |
| `src/index.ts` | Barrel for the published `@umami/components` package (`tsup.config.js`, `package.components.json`). Not used by the app at runtime. |
| `src/i18n/request.ts` | next-intl server config; hardcoded to `en-US` from `public/intl/messages/en-US.json`. |
| `docker/proxy.ts` | Next 16 proxy (middleware). Copied to `src/proxy.ts` at image build (`Dockerfile:25`) — **not active in local dev**. |

---

## URL map

### Pages

| URL | File | Notes |
| --- | --- | --- |
| `/` | `src/app/page.tsx` | Client redirect. |
| `/login`, `/login/two-factor` | `src/app/login/page.tsx` | Returns `null` if `DISABLE_LOGIN` or `CLOUD_MODE`. |
| `/logout` | `src/app/logout/page.tsx` | Same env guards. |
| `/sso` | `src/app/sso/page.tsx` | |
| `/share/:slug/*` | `src/app/share/[slug]/[[...path]]/page.tsx` | Optional catch-all; layout resolves the share token. |
| `/dashboard`, `/dashboard/edit` | `src/app/(main)/dashboard/` | |
| `/boards`, `/boards/:boardId`, `/boards/:boardId/edit`, `/boards/:boardId/design` | `src/app/(main)/boards/` | `/boards/create` is a client-side redirect back to `/boards`. |
| `/websites`, `/websites/:websiteId` | `src/app/(main)/websites/` | |
| `/websites/:id/{realtime,compare,events,sessions,segments,cohorts,replays,settings}` | `src/app/(main)/websites/[websiteId]/` | |
| `/websites/:id/sessions/:sessionId`, `/websites/:id/replays/:replayId` | same | Also intercepted as modals (below). |
| `/websites/:id/{attribution,breakdown,funnels,goals,heatmaps,journeys,performance,retention,revenue,utm}` | `src/app/(main)/websites/[websiteId]/(reports)/` | `(reports)` is organization-only — **no layout file**, so it adds nothing to the URL or the tree. |
| `/links`, `/links/:linkId`, `/links/:linkId/edit` | `src/app/(main)/links/` | |
| `/pixels`, `/pixels/:pixelId`, `/pixels/:pixelId/edit` | `src/app/(main)/pixels/` | |
| `/teams` | `src/app/(main)/teams/page.tsx` | `teams/[teamId]/` holds **components only**, no `page.tsx`. |
| `/settings/{preferences,profile,security,websites,teams}` (+ `:id`) | `src/app/(main)/settings/` | `settings/layout.tsx` returns `null` when `cloudMode`. |
| `/admin/{users,teams,websites,security}` (+ `:id`) | `src/app/(main)/admin/` | `admin/layout.tsx` returns `null` when `cloudMode`. |
| `/console/:websiteId` | `src/app/(main)/console/[websiteId]/page.tsx` | Returns `null` unless `ENABLE_TEST_CONSOLE`. |

### Parallel + intercepting routes

`src/app/(main)/websites/[websiteId]/layout.tsx` accepts a `modal` slot alongside `children`.

- `@modal/default.tsx` → `null` (the non-intercepted state).
- `@modal/(.)sessions/[sessionId]/page.tsx` → renders `SessionProfileModal`.
- `@modal/(.)replays/[sessionId]/page.tsx` → replay modal.

Soft navigation to a session/replay opens a modal; a hard load hits the full page under
`sessions/[sessionId]/`.

### Config-level rewrites & redirects (`next.config.ts`)

| Kind | From | To |
| --- | --- | --- |
| rewrite | `/teams/:teamId/:path*` | `/:path*` |
| rewrite | `/telemetry.js` | `/api/scripts/telemetry` |
| rewrite | `$COLLECT_API_ENDPOINT` | `/api/send` |
| rewrite | `$TRACKER_SCRIPT_NAME` (comma list) | `/script.js` |
| rewrite | `$API_URL/:path*` (when relative and not `/` or `/api`) | `/api/:path*` |
| redirect | `/settings` | `/settings/preferences` |
| redirect | `/teams/:id` | `/teams/:id/websites` |
| redirect | `/teams/:id/settings` | `/teams/:id/settings/preferences` |
| redirect | `/admin` | `/admin/users` |
| redirect | `/teams/:id/dashboard[/edit]` | `/dashboard[/edit]` |

### API families

All under `src/app/api/`. Route counts are `route.ts` files in each subtree.

| Family | Routes | What it covers |
| --- | --- | --- |
| `websites` | 58 | The bulk of analytics: `stats`, `metrics`, `pageviews`, `sessions`, `events`, `event-data`, `session-data`, `revenue`, `replays`, `segments`, `export`, `shares`, `transfer`, `reset`. |
| `reports` | 12 | Saved reports (`[reportId]`) plus one route per report type (`funnel`, `goal`, `journey`, `retention`, `attribution`, `breakdown`, `heatmap`, `performance`, `revenue`, `utm`). |
| `teams` | 9 | Team CRUD, members, join, and team-scoped `websites`/`links`/`pixels`/`boards`. |
| `2fa` | 6 | `status`, `verify`, `disable`, `setup/{initiate,confirm,cancel}`. |
| `admin` | 6 | Cross-tenant `users`/`teams`/`websites` + global 2FA policy. |
| `auth` | 5 | `login`, `logout`, `sso`, `verify`, `subscription`. |
| `me` | 4 | Current user, `password`, `teams`, `websites`. |
| `boards`, `links`, `pixels`, `users` | 4 each | Entity CRUD + `shares`/`charts` sub-resources. |
| `share` | 3 | `[slug]` (mints the share token), `id/[shareId]`. |
| `send`, `batch`, `record` | 1 each | Collection. `batch` loops and re-invokes `send.POST`. |
| `config`, `heartbeat`, `dashboard`, `realtime`, `scripts/telemetry` | 1 each | Misc. |

---

## Request lifecycle

### Page request (e.g. `/teams/T/websites/W/funnels`)

1. **Docker only** — `src/proxy.ts` (from `docker/proxy.ts`) matches `/:path*`, handles custom
   collect endpoint / tracker script rewrites, blocks `/login` when `DISABLE_LOGIN`, and sets
   `Content-Security-Policy` per request via `getContentSecurityPolicy()` (`src/lib/csp.ts`).
   In `next dev` there is no middleware at all — CSP comes only from the build-time
   `headers()` in `next.config.ts`.
2. **`next.config.ts` redirects then rewrites** — `/teams/T/...` is rewritten to
   `/websites/W/funnels`. The `teamId` never reaches the filesystem router.
3. **`src/app/layout.tsx`** — renders `<html>`; short-circuits to an empty `<body>` if
   `DISABLE_UI`. `generateMetadata()` reads `next/headers` and calls
   `getBaseUrl(headerStore)` (`src/lib/get-base-url.ts`), which prefers
   `x-forwarded-host`/`x-forwarded-proto` and falls back to `HOMEPAGE_URL`.
4. **`src/app/Providers.tsx`** (client) mounts Zen UI, the router provider, next-intl, and a
   module-level `QueryClient` (`retry: false`, `staleTime: 60s`).
5. **`src/app/(main)/layout.tsx` → `App.tsx`** (client) is the auth gate: `useLoginQuery()`
   hits `/api/me`; on error it does `window.location.href = '/login'`. It also reads `teamId`
   back out of `usePathname()` (`useNavigation`), persists it to localStorage, and renders
   `SideNav`/`TopNav`/`MobileNav` plus telemetry/self-tracking `<Script>` tags.
6. **`websites/[websiteId]/layout.tsx`** is one of the few genuinely async server components:
   it `await params`, calls `getWebsite(websiteId)` (Prisma) and returns `null` for
   missing/soft-deleted websites, then renders the client `WebsiteLayout` with `{children}{modal}`.
7. **`(reports)/funnels/page.tsx`** awaits `params` and renders `<FunnelsPage websiteId={...} />`.
8. That client page fetches data through `useApi()`.

### API request (e.g. `GET /api/websites/W/stats`)

1. `next.config.ts` attaches `apiHeaders` (`Access-Control-Allow-Origin: *`, `Cache-Control: no-cache`)
   to `/api/:path*`.
2. The client calls `useApi().get()` (`src/components/hooks/useApi.ts`), which resolves the URL
   through `getApiUrl()` (`src/lib/api-url.ts` — honors `apiUrl`/`basePath`, but forces
   `/auth/*` and `/config` to stay on the app origin) and sets
   `authorization: Bearer <localStorage token>` plus the share headers when a share is active.
3. `src/lib/fetch.ts` issues the `fetch` with `cache: 'no-cache'`.
4. The route handler calls `parseRequest(request, schema)` (`src/lib/request.ts:16`), which:
   - Zod-parses query (GET) or body (non-GET); on failure returns an `error()` thunk wrapping
     `badRequest(z.treeifyError(...))`.
   - Re-injects dynamic filter keys Zod strips — anything matching `/\d+$/`, `/^pf_/`,
     `/^epf\d+$/`, `/^spf\d+$/` (`src/lib/request.ts:37-45`).
   - Unless `{ skipAuth: true }`, runs `checkAuth(request)` (`src/lib/auth.ts:23`): parses the
     Bearer JWT (or a Redis `authKey`), reloads the user, and rejects the token if
     `hash(user.password) !== payload.pwd` so a password change invalidates old tokens. Share
     tokens are accepted only when the `SHARE_CONTEXT_HEADER` is also present.
5. The handler checks a `can*` predicate from `@/permissions` and returns `unauthorized()` if false.
6. `getQueryFilters(query, websiteId)` builds a `QueryFilters` — date range, filters, segment and
   cohort expansion, and `setWebsiteDate` clamping for `resetAt` / cloud retention.
7. Query layer: `@/queries/prisma` for entities, `@/queries/sql` for analytics.
8. Response via `src/lib/response.ts` helpers — `json`, `ok`, `badRequest`, `unauthorized`,
   `forbidden`, `notFound`, `payloadTooLarge`, `serviceUnavailable`, `serverError`. All errors
   share the shape `{ error: { message, code, status } }`, which `useApi`'s `handleResponse`
   unwraps into a rejected `Error` with `.code` / `.status`.

---

## Conventions for adding a page or route

### New page

Copy `src/app/(main)/websites/[websiteId]/(reports)/funnels/page.tsx` (12 lines).

- `page.tsx` is a **server component** and stays thin: unwrap `params` (a `Promise` in Next 15+),
  render a sibling `XxxPage.tsx` client component, export `metadata`.
- Default exports are anonymous: `export default function () {}` / `export default async function ({ params })`.
- Feature components live **next to the route** (`WebsitesPage.tsx`, `WebsiteNav.tsx`, …), not in
  `src/components/`. `src/components/` is for cross-feature primitives only.
- Put `'use client'` on the sibling component, not on `page.tsx`. Only two `page.tsx` files in
  the whole app are client components (`src/app/page.tsx`, `(main)/boards/create/page.tsx`) and
  both exist solely to redirect.
- Data comes from `useApi()` + TanStack Query. **There are zero `'use server'` server actions in
  this codebase** and only `websites/[websiteId]/layout.tsx` and `share/[slug]/layout.tsx` do
  server-side data loading.
- Gate a whole subtree with an env check in its `layout.tsx` returning `null`
  (`(main)/settings/layout.tsx`, `(main)/admin/layout.tsx`).
- Add nav entries in `src/app/(main)/SideNav.tsx`; build hrefs with `renderUrl()` from
  `useNavigation()` so the `/teams/:id` prefix is preserved.

### New API route

Copy `src/app/api/websites/[websiteId]/stats/route.ts` (read) or
`src/app/api/websites/route.ts` (read + write).

Every handler follows the same five steps:

```
const schema = z.object({ ... });                      // or withDateRange({ ...filterParams })
const { auth, query, body, error } = await parseRequest(request, schema);
if (error) return error();                             // note: error is a THUNK, must be called
const { websiteId } = await params;
if (!(await canViewWebsiteSection(auth, websiteId, [...]))) return unauthorized();
return json(await getWebsiteStats(websiteId, await getQueryFilters(query, websiteId)));
```

- Reuse schema fragments from `src/lib/schema.ts`: `pagingParams`, `searchParams`,
  `sortingParams`, `filterParams`, `replayParams`, `withDateRange()`.
- Never build a `Response` by hand — use `src/lib/response.ts`.
- Public/unauthenticated routes pass `{ skipAuth: true }` (`api/auth/login`, `api/config`,
  `api/send`, `api/batch`).
- Permission predicates go in `src/permissions/*.ts` and are re-exported from its `index.ts`.

---

## Gotchas

- **`typescript.ignoreBuildErrors: true`** (`next.config.ts`). `next build` will not catch type
  errors; run `tsc`/`biome` yourself.
- **`parseRequest` returns `error` as a function.** `if (error) return error();` — returning
  `error` directly ships a function, not a `Response`.
- **`process.env` in client code only works for the `env` allowlist** in `next.config.ts`:
  `apiUrl`, `basePath`, `cloudMode`, `cloudUrl`, `currentVersion`, `defaultCurrency`,
  `defaultLocale`, `selfTrack`, `selfRecord`. Note these are camelCase on the client
  (`process.env.cloudMode`) but SCREAMING_CASE on the server (`process.env.CLOUD_MODE`) — both
  spellings appear in the codebase and they are **not** interchangeable.
- **`teamId` is not a route param.** The `/teams/:teamId/:path*` rewrite strips it before the
  router sees it; `useNavigation()` re-extracts it with a regex against `usePathname()`. The
  same trick is used for `websiteId`, `linkId`, `pixelId`, `boardId`.
- **`src/app/(main)/teams/[teamId]/` has no `page.tsx`** — it is a component folder only. The
  `/teams/:id` URL is a redirect to `/teams/:id/websites`.
- **`(reports)` has no layout.** It exists purely to group ten sibling report folders.
- **Middleware is Docker-only.** `docker/proxy.ts` is copied to `src/` at image build time. Any
  behavior you put there (custom collect endpoint, `DISABLE_LOGIN` enforcement, per-request CSP)
  silently does not apply in `next dev` or in a plain `next build`.
- **CSP is computed at build time by `next.config.ts`** and again at startup in the proxy. Env
  changes to `ALLOWED_FRAME_URLS` / `API_URL` require a rebuild unless the proxy is active
  (documented in the comment at the top of `src/lib/csp.ts`).
- **CORS is applied two different ways.** `next.config.ts` sets permissive `apiHeaders` on
  `/api/:path*`; only `api/record/route.ts` and `api/websites/[websiteId]/recorder/route.ts`
  additionally use `src/lib/cors.ts` (`corsPreflight`, `withCorsHeaders`) and are the only routes
  exporting an `OPTIONS` handler.
- **Collection routes call each other directly.** `api/batch/route.ts` and both
  `(collect)/{p,q}/[slug]/route.ts` import `POST` from `@/app/api/send/route` and invoke it with a
  hand-built `Request`. Changing `send`'s signature breaks all three.
- **i18n is stubbed server-side.** `src/i18n/request.ts` always returns `en-US`; the real locale
  switching happens client-side in `Providers.tsx` via `useLocale()`.
- **`src/index.ts` is not application code** — it is the entry point for the separately published
  `@umami/components` package. Adding an app file there has no runtime effect.
- **`reactStrictMode: false`** and `output: 'standalone'` (unless `VERCEL` is set).
