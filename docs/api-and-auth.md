# HTTP API, Auth, Authorization, Validation

Next.js App Router. Every endpoint is a `route.ts` under `src/app/api/**` exporting `GET`/`POST`/`DELETE` (and `OPTIONS` in one case). There is **no middleware file** (`src/middleware.ts` does not exist) — auth is enforced per-handler by calling `parseRequest`.

## Route map

Paths below are relative to `/api`. `[x]` = dynamic segment. Files live at `src/app/api/<path>/route.ts`.

### Auth & identity
| Path | Methods | Purpose |
|---|---|---|
| `/auth/login` | POST | Username+password → session token, or `{requiresTwoFactor, partialToken}` |
| `/auth/verify` | POST | Validate current bearer token, return user + teams |
| `/auth/logout` | POST | Delete the Redis auth key (no-op without Redis) |
| `/auth/sso` | POST | Mint a 24h SSO token (Redis required) |
| `/auth/subscription` | GET | Cloud subscription info |
| `/me`, `/me/password`, `/me/teams`, `/me/websites` | GET / POST | Current-user profile, password change, own teams/websites |
| `/2fa/status`, `/2fa/verify`, `/2fa/disable` | GET/POST | 2FA state, OTP verification, disable |
| `/2fa/setup/initiate`, `/2fa/setup/confirm`, `/2fa/setup/cancel` | POST | TOTP enrolment |

### Admin (all gated on `user.isAdmin`)
| Path | Methods | Purpose |
|---|---|---|
| `/admin/users`, `/admin/teams`, `/admin/websites` | GET | Global paged lists |
| `/admin/2fa/global` | POST | Enforce 2FA org-wide |
| `/admin/users/[userId]/2fa` | GET, POST, DELETE | Per-user 2FA enforcement |
| `/admin/teams/[teamId]/2fa` | POST | Per-team 2FA enforcement |

### Entities (CRUD)
| Path | Methods | Purpose |
|---|---|---|
| `/websites` | GET, POST | List own websites (`?includeTeams=1`), create |
| `/websites/[websiteId]` | GET, POST, DELETE | Read / update / delete |
| `/websites/[websiteId]/reset`, `/transfer` | POST | Wipe data, move to user or team |
| `/websites/charts` | GET | Multi-website chart data |
| `/users` | POST | Create user (admin) |
| `/users/[userId]` | GET, POST, DELETE | Read / update / delete |
| `/users/[userId]/teams`, `/websites` | GET | User's teams / websites |
| `/teams`, `/teams/[teamId]` | GET, POST, DELETE | Team CRUD |
| `/teams/join` | POST | Join via `accessCode` (joins as `team-member`) |
| `/teams/[teamId]/users`, `/users/[userId]` | GET, POST, DELETE | Membership + role |
| `/teams/[teamId]/websites`, `/boards`, `/links`, `/pixels` | GET | Team-scoped lists |
| `/boards`, `/boards/[boardId]`, `/clone`, `/shares` | GET, POST, DELETE | Dashboard boards |
| `/links`, `/links/[linkId]`, `/shares`, `/links/charts` | GET, POST, DELETE | Short links |
| `/pixels`, `/pixels/[pixelId]`, `/shares`, `/pixels/charts` | GET, POST, DELETE | Tracking pixels |
| `/websites/[websiteId]/segments[/segmentId]` | GET, POST, DELETE | Saved segments / cohorts |
| `/dashboard` | GET, POST | Dashboard config |

### Analytics / metrics (read-only, `GET` unless noted)
| Path | Purpose |
|---|---|
| `/websites/[websiteId]/stats`, `/pageviews`, `/metrics`, `/metrics/expanded`, `/values`, `/active`, `/daterange` | Core report data |
| `/websites/[websiteId]/events`, `/events/series`, `/events/stats` | Custom events |
| `/websites/[websiteId]/event-data{,/events,/fields,/properties,/stats,/values,/[eventId]}` | Event property data |
| `/websites/[websiteId]/event-data-pivot{,/array-series,/date-series,/numeric-series,/numeric-stats,/property-series}` | Pivot queries |
| `/websites/[websiteId]/session-data{,/array-series,/date-series,/numeric-series,/numeric-stats,/properties,/property-series,/stats,/values}`, `/session-data-pivot` | Session property data |
| `/websites/[websiteId]/sessions{,/stats,/weekly,/[sessionId]{,/activity,/properties,/replays}}` | Sessions (`DELETE` on `[sessionId]`) |
| `/websites/[websiteId]/revenue/{chart,metrics,sessions,stats}` | Revenue |
| `/websites/[websiteId]/replays{,/[replayId],/saved,/saved/[replayId]}` | Session replay |
| `/websites/[websiteId]/export`, `/reports` | CSV export, saved reports for a site |
| `/realtime/[websiteId]` | Realtime feed |

### Reports
| Path | Methods | Purpose |
|---|---|---|
| `/reports`, `/reports/[reportId]` | GET, POST, DELETE | Saved report CRUD |
| `/reports/{attribution,breakdown,funnel,goal,heatmap,journey,performance,retention,revenue,utm}` | POST | Run a report; body validated by `reportResultSchema` |

### Sharing
| Path | Methods | Purpose |
|---|---|---|
| `/share` | POST | Create a share for an entity |
| `/share/id/[shareId]` | GET, POST, DELETE | Manage an existing share |
| `/share/[slug]` | GET | **Unauthenticated**: slug → share token (see share flow) |

### Ingestion & infra (unauthenticated)
| Path | Methods | Purpose |
|---|---|---|
| `/send` | POST | Tracker event ingestion |
| `/batch` | POST | Up to 500 `/send` payloads; re-dispatches into `send.POST` |
| `/record` | POST | Session-replay recording ingestion |
| `/config` | GET | Public client config (cloud/private mode, tracker name) |
| `/heartbeat` | GET | `{ok:true}`; the only route with no `parseRequest` at all |
| `/scripts/telemetry` | GET | Telemetry pixel (suppressed when `PRIVATE_MODE`) |
| `/websites/[websiteId]/recorder` | GET, OPTIONS | CORS-enabled recorder config for the tracker |

## Anatomy of a route handler

`src/app/api/websites/[websiteId]/metrics/route.ts` is the canonical shape — **copy this file when adding a read endpoint**; copy `src/app/api/websites/[websiteId]/route.ts` for a write endpoint.

```ts
export async function GET(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },   // 1. params is a Promise (Next 15)
) {
  const schema = withDateRange({                             // 2. zod schema, inline, from @/lib/schema
    type: z.string(),
    limit: z.coerce.number().optional(),                     //    z.coerce for query strings
    ...searchParams,
    ...filterParams,
  });

  const { auth, query, error } = await parseRequest(request, schema);  // 3. validate + authenticate

  if (error) {
    return error();                                          // 4. ALWAYS this exact early return
  }

  const { websiteId } = await params;                        // 5. await params after the error gate

  if (!(await canViewWebsiteSection(auth, websiteId, [...]))) {        // 6. authorization
    return unauthorized();
  }

  const filters = await getQueryFilters(query, websiteId);   // 7. query params -> QueryFilters
  return json(await getSessionMetrics(websiteId, { type }, filters));  // 8. json()/ok() on success
}
```

Rules that hold across essentially all 128 route files:

- `parseRequest(request, schema?, options?)` — `src/lib/request.ts`. Returns `{ url, query, body, auth, error }`. For `GET` the schema validates `query`; for anything else it validates `body`. `error` is a **thunk** — call it.
- Handler signature for dynamic routes: `(request, { params }: { params: Promise<{...}> })`.
- Business logic lives in `src/queries/prisma/*` (relational) and `src/queries/sql/*` (ClickHouse/analytics); routes never write SQL.
- Auth object type: `Auth` in `src/lib/types.ts` (`{ user?, shareToken? }`).

## Auth flows

### 1. Password login (`src/app/api/auth/login/route.ts`)
1. `parseRequest(request, schema, { skipAuth: true })` validates `{username, password}`.
2. `getUserByUsername(..., {includePassword: true})`; `checkPassword` (bcrypt, `src/lib/password.ts`) → else `unauthorized({code:'incorrect-username-password'})`.
3. If a `twoFactorAuth` row has `isEnabled` (and not `CLOUD_MODE`) → return `{requiresTwoFactor:true, partialToken}`; the partial token is `createSecureToken({userId, type:'partial-auth'}, secret(), {expiresIn:'5m'})`.
4. Otherwise compute `pwd = hash(user.password)` (`src/lib/crypto.ts`).
5. With Redis: `saveAuth({userId, role, pwd})` stores in Redis under `auth:<random>` and returns `createSecureToken({authKey})`. Without Redis: `createSecureToken({userId, role, pwd}, secret())` — fully stateless.
6. Client stores it in localStorage key `umami.auth` (`src/lib/client.ts`, `AUTH_TOKEN` in `src/lib/constants.ts`) and sends `Authorization: Bearer <token>` on every call (`src/components/hooks/useApi.ts`).

### 2. Token verification on each request (`checkAuth` in `src/lib/auth.ts`)
1. `getBearerToken(request)` splits the `authorization` header on space.
2. `parseSecureToken(token, secret())` = AES-256-GCM decrypt then `jwt.verify` (`src/lib/jwt.ts`, `src/lib/crypto.ts`).
3. Payload with `userId` → stateless path: load user, and if `payload.pwd` exists reject when `hash(user.password) !== payload.pwd` (password change invalidates tokens).
4. Payload with `authKey` and Redis enabled → look up `redis.client.get(authKey)`, same `pwd` fingerprint check.
5. Also parses a share token. If there is no user and no share token → `null` → `unauthorized()`.
6. On success strips `user.password` and sets `user.isAdmin = user.role === 'admin'`.

`secret()` = `hash(APP_SECRET || DATABASE_URL)`. There is **no separate API-key mechanism** — a bearer token from `/auth/login` (or `/auth/sso`) *is* the API credential. No `apiKey`/`x-api-key` handling exists anywhere in `src/`.

### 3. Share token (`src/app/api/share/[slug]/route.ts`, `src/lib/auth.ts`)
1. Public `GET /api/share/[slug]` — no auth at all. Looks up the share by slug, resolves the entity (website / pixel / link / board).
2. For boards it filters the embedded entity ids down to ones the share *owner* may view (`filterBoardEntityIdsForShare`).
3. Mints `createToken({...data, type: 'share'}, secret())` — a plain signed JWT, **not** encrypted.
4. Client (`src/app/share/ShareProvider.tsx` → `useApi`) sends it as `x-umami-share-token`, plus `x-umami-share-context: 1`.
5. `parseShareToken` rejects tokens whose `type !== 'share'` — this stops the `/api/send` cache token (same secret) from being replayed as a share token.
6. `checkAuth` additionally rejects share tokens sent **without** the `x-umami-share-context` header.
7. Section gating: `canViewWebsiteSection(auth, websiteId, sections)` in `src/permissions/share.ts` checks `shareToken.parameters[section] === true`. If the token carries *no* boolean section flags at all, it is treated as full access.

### 4. SSO (`src/app/api/auth/sso/route.ts`, `src/app/sso/SSOPage.tsx`)
1. Caller must already be authenticated (normal `parseRequest`).
2. **Requires Redis** — returns `serverError('Redis is disabled')` otherwise.
3. `saveAuth({userId, pwd}, 86400)` → token with 24h Redis TTL.
4. Front end navigates to `/sso?token=...&url=...`; `SSOPage` validates the redirect with `isSafeRedirectUrl` (must start with a single `/`, no `:`), stores the token, then routes.

### 5. Two-factor (`src/app/api/2fa/**`, `src/lib/two-factor/*`)
1. `POST /2fa/setup/initiate` creates a TOTP secret, encrypted with AES-256-GCM using `TWO_FACTOR_ENCRYPTION_KEY` (64 hex chars) — `src/lib/two-factor/crypto.ts`.
2. `POST /2fa/setup/confirm` verifies a 6-digit code and issues backup codes (`backup-codes.ts`).
3. Login returns a 5-minute `partial-auth` token instead of a session token.
4. `POST /2fa/verify` reads that partial token from the `Authorization` header manually (it calls `parseRequest` with `skipAuth: true`), accepts `{token}` **or** `{backupCode}` via `z.union([...].strict())`.
5. Guards: `checkRateLimit`/`recordFailedAttempt` (5 attempts → 15-minute lockout, `rate-limit.ts`, serializable transaction with P2034 retry) and `isOtpReplayed`/`markOtpUsed` (90s single-use window, `replay-prevention.ts`).
6. On success mints the normal session token exactly as login does.
7. All 2FA routes return `notFound()` when `CLOUD_MODE` is set, and `serviceUnavailable(...)` when `TWO_FACTOR_ENCRYPTION_KEY` is missing/invalid.

## Authorization

Roles and permissions: `src/lib/constants.ts` (`ROLES`, `PERMISSIONS`, `ROLE_PERMISSIONS`, `TEAM_ROLE_RANK`).

| Role | Permissions |
|---|---|
| `admin` | `all` (plus every `user.isAdmin` short-circuit in `src/permissions/**`) |
| `user` | `website:create`, `website:update`, `website:delete`, `team:create` |
| `view-only` | none |
| `team-owner` | `team:update`, `team:delete`, `website:{create,update,delete}`, `website:transfer-to-team`, `website:transfer-to-user` |
| `team-manager` | `team:update`, `website:{create,update,delete}`, `website:transfer-to-team` |
| `team-member` | `website:{create,update,delete}` |
| `team-view-only` | none |

- Low-level check: `hasPermission(role, permission | permission[])` in `src/lib/auth.ts` — OR semantics over `ROLE_PERMISSIONS[role]`.
- **Routes should not call `hasPermission` directly.** Call a `can*` helper from `@/permissions` (barrel at `src/permissions/index.ts`), which takes `(auth, ...ids)` and resolves ownership → team membership → role permission.

| Need | Helper | File |
|---|---|---|
| View analytics for a website/pixel/link | `canViewWebsite`, `canViewBatchWebsites` | `permissions/website.ts` |
| View a specific share section | `canViewWebsiteSection(auth, id, section\|sections)` | `permissions/share.ts` |
| View website allowing a share token | `canViewSharedWebsite`, `canViewSharedWebsiteFilters` | `permissions/share.ts` |
| Require a logged-in user (no share) | `canViewAuthenticatedWebsite` | `permissions/share.ts` |
| Website CRUD / transfer | `canCreateWebsite`, `canUpdateWebsite`, `canDeleteWebsite`, `canTransferWebsiteToUser`, `canTransferWebsiteToTeam` | `permissions/website.ts` |
| Generic entity by id (website/link/pixel/board) | `canViewEntity`, `canUpdateEntity`, `canDeleteEntity` | `permissions/entity.ts` |
| Teams | `canViewTeam`, `canCreateTeam`, `canUpdateTeam`, `canDeleteTeam`, `canDeleteTeamUser`, `canCreateTeamWebsite`, `canViewAllTeams` | `permissions/team.ts` |
| Users | `canViewUser`, `canViewUsers`, `canCreateUser`, `canUpdateUser`, `canDeleteUser` | `permissions/user.ts` |
| Boards / links / pixels / reports | `permissions/{board,link,pixel,report}.ts` | |

## Validation conventions

- **zod v4**, always applied through `parseRequest`'s second argument. Schemas are declared **inline inside the handler** (or at module scope for ingestion routes like `/send` and `/batch`).
- Shared building blocks live in `src/lib/schema.ts` and are **spread** into the object, not composed: `...pagingParams`, `...searchParams`, `...sortingParams`, `...filterParams`, `...replayParams`, `...dateRangeParams`.
- `withDateRange(shape)` wraps `dateRangeParams` + your shape and `superRefine`s that either `startAt`+`endAt` or `startDate`+`endDate` is present.
- Reusable leaf params: `timezoneParam`, `unitParam`, `userRoleParam`, `teamRoleParam`, `anyObjectParam`, `urlOrPathParam`, `fieldsParam`, `reportTypeParam`, `operatorParam`, `segmentParamSchema`.
- Report bodies use `reportResultSchema` = `z.intersection(websiteId+filters, reportTypeSchema)` where `reportTypeSchema` is a `discriminatedUnion('type', ...)` of the ten per-report schemas.
- Use `z.coerce.*` for anything arriving via query string; plain types are fine in JSON bodies.
- Validation failure → `badRequest(z.treeifyError(result.error))`, i.e. a 400 whose body merges the zod tree into `error`.
- Filter params are extracted post-validation by `getRequestFilters` / `getQueryFilters` (`src/lib/request.ts`) against `FILTER_COLUMNS`; property filters by `src/lib/params.ts` (`parseUniversalEventPropertyFilters`, `parseSessionPropertyFilters`).

## Response conventions

All helpers in `src/lib/response.ts`. Error bodies are uniformly `{ error: { message, code, status, ...extra } }`.

| Helper | Status | Body / notes |
|---|---|---|
| `json(data)` | 200 | Raw payload, no envelope |
| `ok()` | 200 | `{ ok: true }` — used for DELETE and logout |
| `badRequest(extra?)` | 400 | `code: 'bad-request'`; also carries zod errors |
| `unauthorized(extra?)` | 401 | `code: 'unauthorized'` |
| `forbidden(extra?)` | 403 | `code: 'forbidden'` |
| `notFound(extra?)` | 404 | `code: 'not-found'` |
| `payloadTooLarge(extra?)` | 413 | `code: 'payload-too-large'` |
| `serverError(e?)` | 500 | Logs `serializeError(e)`; message only surfaces if `e` is a string |
| `serviceUnavailable(extra?)` | 503 | `code: 'service-unavailable'` |

Client-side, `useApi`'s `handleResponse` rejects with `new Error(message)` decorated with `{code, status}` (`src/components/hooks/useApi.ts`).

## Gotchas

- **Schema validation runs before authentication.** In `parseRequest`, if the schema fails, `error` is set and `checkAuth` is never called — an unauthenticated caller gets a detailed 400 instead of a 401.
- **403 is nearly unused.** 102 route files call `unauthorized()` (401) for *authorization* failures; `forbidden()` appears in only three (`/2fa/disable`, `/send`, `/record`). Follow the existing convention and return `unauthorized()`.
- **Updates use `POST`, not `PUT`.** No route file exports a `PUT`, even though `httpPut` exists in `src/lib/fetch.ts`.
- **Query-param filters survive zod stripping by hand.** `parseRequest` re-adds keys matching `/\d+$/`, `/^pf_/`, `/^epf\d+$/`, `/^spf\d+$/` from the raw query after parsing, because suffixed filters (`browser1`, `os2`) aren't in the schema.
- **Share tokens are signed, not encrypted** (`createToken`), unlike session tokens (`createSecureToken` = encrypt(jwt)). Anyone holding the token can read its claims.
- **Share tokens have no expiry** and are revoked only by deleting the share row.
- **A share token is inert without `x-umami-share-context`** — `checkAuth` rejects the request even though the token verifies.
- **Empty share `parameters` means full access**, not no access (`canViewWebsiteSection` returns `true` when no section booleans are present).
- **Password-change invalidation is opt-in per token.** `checkAuth` only enforces the `pwd` fingerprint when the token/Redis entry has one, so legacy tokens minted without it stay valid.
- **`/api/2fa/verify` mints a session token without a `pwd` fingerprint**, unlike `/api/auth/login` — those sessions survive a password change.
- **`/api/auth/sso` hard-fails without Redis**, returning a 500 rather than a 503/400.
- `GET`/`DELETE` on `/api/share/id/[shareId]` dereference `share.entityId` with no null check (only `POST` calls `notFound()`), so an unknown id yields a 500.
- **`/api/batch` re-enters `send.POST`** by constructing a fresh `Request` (it cannot clone the incoming one); it copies headers, forces JSON content-type, drops `content-length`, and always returns 200 with a per-item `details` array.
- Some `can*` helpers return truthy objects rather than booleans (`canViewTeam` returns the `teamUser` row). Always use them inside `if (!(await can...))`.
- `CLOUD_MODE` changes behaviour at runtime: it disables 2FA entirely, enables the website-count limit in `POST /api/websites`, and caps analytics range to 6 months for unsubscribed accounts (`setWebsiteDate`).
