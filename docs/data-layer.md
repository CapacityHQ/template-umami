# Data Layer

Databases, schema, query modules, caching, and messaging in this Umami codebase.
Every claim below is traceable to the cited file.

## 1. Storage topology

| Store | Required? | Enabled by | Holds |
| --- | --- | --- | --- |
| PostgreSQL | Yes, always | `DATABASE_URL` | All config/metadata (users, teams, websites, reports, boards, shares, 2FA). In the default deployment it *also* holds analytics events. |
| ClickHouse | Optional | `CLICKHOUSE_URL` | Analytics events only (`website_event`, `event_data`, `session_data`, revenue, replays, heatmaps). When set, Postgres stops being used for analytics reads/writes. |
| Redis | Optional | `REDIS_URL` | Cache + rate limiting + auth token/session lookups. Never a source of truth. |
| Kafka | Optional | `KAFKA_URL` **and** `KAFKA_BROKER` | Write-path buffer in front of ClickHouse. Ingest only; never read by the app. |

- Postgres minimum version is enforced at 9.4 (`scripts/check-db.js`, `MIN_VERSION_NUM = 90400`).
- Prisma datasource is hard-coded `postgresql` with `relationMode = "prisma"` (`prisma/schema.prisma:8-11`) — **no DB-level foreign keys**, referential integrity is emulated by Prisma.
- Generated client goes to `src/generated/prisma` (`prisma/schema.prisma:1-5`), then is esbuild-bundled to `generated/prisma/client.js` by `scripts/build-prisma-client.js`.
- `prisma.config.ts` only wires `datasource.url` from `DATABASE_URL` via `dotenv`.

### Runtime store selection

`src/lib/db.ts` is the whole decision:

```
runQuery(queries)          // src/lib/db.ts:27-39
  if (CLICKHOUSE_URL)  ->  queries[KAFKA] ?? queries[CLICKHOUSE]
  else if db type is postgresql -> queries[PRISMA]
```

- `getDatabaseType()` parses the scheme off `DATABASE_URL`; `postgres:` is normalized to `postgresql`.
- `isRelationalOnly()` = no `CLICKHOUSE_URL` **and** Postgres. Used to gate features ClickHouse can't do, e.g. session deletion (`src/app/api/config/route.ts:20`, `src/app/api/websites/[websiteId]/sessions/[sessionId]/route.ts:19,70`).
- `notImplemented()` throws; used as the `[PRISMA]` branch for ClickHouse-only queries (`src/queries/sql/events/getEventUsage.ts`, `getEventDataUsage.ts`).

## 2. Prisma model reference

Source: `prisma/schema.prisma`. All models `@@map` to snake_case tables; all ids are `@db.Uuid` except the 2FA models (`cuid()`).

| Model | Table | Purpose | Key relations |
| --- | --- | --- | --- |
| `User` | `user` | Accounts, role, soft-deleted via `deletedAt` | -> `Website[]` (owner + `createdBy`), `TeamUser[]`, `Report[]`, `Board[]`, `Link[]`, `Pixel[]`, 2FA models |
| `Team` | `team` | Shared ownership unit, `accessCode` for join links | -> `Website[]`, `TeamUser[]`, `Link[]`, `Pixel[]`, `Board[]` |
| `TeamUser` | `team_user` | Membership + role join table | -> `Team`, `User` |
| `Website` | `website` | Tracked site; `resetAt`, `recorderEnabled`, `replayConfig` JSON | owner `User` or `Team`; -> `EventData`, `SessionData`, `Report`, `Revenue`, `Segment`, `SessionReplay`, `SessionReplaySaved`, `HeatmapEvent` |
| `Session` | `session` | One visitor identity per website (browser/os/device/geo/`distinctId`) | -> `WebsiteEvent[]`, `SessionData[]`, `Revenue[]` |
| `SessionLink` | `session_link` | Maps `distinctId` -> session ids; composite PK `(websiteId, distinctId, sessionId)` | none declared |
| `WebsiteEvent` | `website_event` | The event fact table: url/referrer/UTM/click-ids/tag/hostname + web-vitals (`lcp`,`inp`,`cls`,`fcp`,`ttfb`) | -> `Session`, `EventData[]` |
| `EventData` | `event_data` | Typed key/value properties per event (`dataType` per `DATA_TYPE`) | -> `Website`, `WebsiteEvent` |
| `SessionData` | `session_data` | Typed key/value properties per session; `@@unique([sessionId, dataKey])` | -> `Website`, `Session` |
| `Revenue` | `revenue` | Denormalized revenue rows extracted from event data | -> `Website`, `Session` |
| `Report` | `report` | Saved report; `parameters` JSON | -> `User`, `Website` |
| `Segment` | `segment` | Saved filter/cohort; `parameters` JSON | -> `Website` |
| `Board` | `board` | Dashboard definition; `parameters` JSON | -> `User` or `Team` |
| `Share` | `share` | Public share link by `slug` for any entity (`entityId` + `shareType`, see `ENTITY_TYPE`) | **no relation fields** — polymorphic by `entityId` |
| `Link` | `link` | Short link (`slug` -> `url`), tracked as `EVENT_TYPE.linkEvent` | -> `User` or `Team` |
| `Pixel` | `pixel` | Tracking pixel by `slug`, `EVENT_TYPE.pixelEvent` | -> `User` or `Team` |
| `SessionReplay` | `session_replay` | rrweb chunks as `Bytes`, `chunkIndex` ordered | -> `Website` |
| `SessionReplaySaved` | `session_replay_saved` | Bookmarked replay, unique `(websiteId, visitId)` | -> `Website` |
| `HeatmapEvent` | `heatmap_event` | Click/scroll coords per `urlPath` (`HEATMAP_EVENT_TYPE`) | -> `Website` |
| `TwoFactorAuth` / `TwoFactorBackupCode` / `TwoFactorOtpUsed` / `TwoFactorRateLimit` | `two_factor_*` | TOTP secret, backup codes, OTP replay guard, lockout counter | all -> `User` with `onDelete: Cascade` |
| `AppSetting` | `app_setting` | Free-form key/value app settings | none |

Enum-ish integers live in `src/lib/constants.ts`:
`EVENT_TYPE` = pageView 1, customEvent 2, linkEvent 3, pixelEvent 4, performance 5.
`DATA_TYPE` = string 1, number 2, boolean 3, date 4, array 5.

## 3. ClickHouse schema

Source: `db/clickhouse/schema.sql` (database `umami`), plus 14 numbered files in `db/clickhouse/migrations/`.

| Object | Engine | Stores |
| --- | --- | --- |
| `website_event` | `MergeTree`, `ORDER BY (toStartOfHour(created_at), website_id, session_id, visit_id, created_at)` | Raw events. **Session attributes are denormalized onto every row** (browser, os, device, screen, language, country, region, city, `distinct_id`) — there is no `session` table in ClickHouse. |
| `event_data` | `MergeTree`, `ORDER BY (website_id, event_id, data_key, created_at)` | Typed event properties |
| `session_data` | `ReplacingMergeTree`, `ORDER BY (website_id, session_id, data_key)` | Typed session properties; queried with `FINAL`. Carries a `session_data_property_filter_projection`. |
| `website_event_stats_hourly` + `_mv` | `AggregatingMergeTree` | Hourly per-visit rollup (`views`, `min_time`, `max_time`, `argMin/argMax` entry/exit url, `groupArray` of paths/UTMs/event names). This is the table most read queries hit instead of `website_event`. |
| `website_revenue` + `_mv` | `MergeTree` | Revenue rows derived from `event_data` rows whose `data_key` matches `revenue` joined to `currency` |
| `session_replay` | `MergeTree` | rrweb chunks, `events String CODEC(ZSTD(3))` |
| `event_data_pivot` + `_mv` | `AggregatingMergeTree` | Per-event property keys/values/types as `groupArrayState` arrays |
| `session_data_pivot` + `_mv` | `AggregatingMergeTree` | Same, per session, partitioned by `created_year_month` |
| `heatmap_event` | `MergeTree`, `ORDER BY (website_id, url_path, event_type, created_at)` | Click/scroll coords |
| `session_link` | `ReplacingMergeTree` | `distinct_id` -> session mapping, bloom filter index on `session_id` |

`website_event` also has two projections: `website_event_url_path_projection` and `website_event_referrer_domain_projection`.

## 4. Query layer

Two directories, two purposes:

| Directory | Contains | Talks to |
| --- | --- | --- |
| `src/queries/prisma/**` | CRUD on config entities (`user`, `team`, `teamUser`, `website`, `report`, `segment`, `board`, `link`, `pixel`, `share`, `session`, `sessionReplay`) | Postgres only, via the Prisma model API |
| `src/queries/sql/**` | Analytics reads + event writes, grouped by domain (`events/`, `sessions/`, `pageviews/`, `reports/`, `heatmap/`, `replays/`, `performance/`) | Dual: raw SQL against Postgres **or** ClickHouse |

Both directories have a barrel `index.ts` that re-exports every module — add your new file there (`src/queries/sql/index.ts`, `src/queries/prisma/index.ts`).

### The dual-implementation pattern

Canonical shape, copy from **`src/queries/sql/getWebsiteStats.ts`**:

```ts
const FUNCTION_NAME = 'getWebsiteStats';          // passed to rawQuery for logging

export async function getWebsiteStats(...args): Promise<WebsiteStatsData[]> {
  return runQuery({
    [PRISMA]: () => relationalQuery(...args),
    [CLICKHOUSE]: () => clickhouseQuery(...args),
  });
}

async function relationalQuery(...) { const { rawQuery, parseFilters } = prisma; /* ... */ }
async function clickhouseQuery(...) { const { rawQuery, parseFilters } = clickhouse; /* ... */ }
```

Conventions observed across the tree:
- One exported function per file, file name == function name (`getPageviewStats.ts` exports `getPageviewStats`).
- Private halves are always named `relationalQuery` and `clickhouseQuery`.
- `FUNCTION_NAME` constant is the third arg to `rawQuery` and is only used when `LOG_QUERY` is set.
- Exported result types are declared in the same file (`export interface WebsiteStatsData`).
- Tests sit next to the module: `getWebsiteStats.test.ts`, `getFunnel.test.ts`, etc.

### Parameter binding differs per engine

| | Postgres (`src/lib/prisma.ts`) | ClickHouse (`src/lib/clickhouse.ts`) |
| --- | --- | --- |
| Placeholder | `{{name}}` or `{{name::uuid}}` | `{name:UUID}`, `{name:DateTime64}`, `{name:Array(String)}` |
| Mechanism | `executeRawQuery` regex-replaces `{{...}}` with `$1,$2,...` then `$queryRawUnsafe` | passed as `query_params` to the ClickHouse client |
| Equality on list | `col = ANY($n)` / `!= ALL($n)` | `col IN {p:Array(String)}` |
| Case-insensitive contains | `ilike` | `positionCaseInsensitive(...) > 0` |
| Regex | `~*` / `!~*` | `match(col, concat('(?i)', v))` |
| Date truncation | `to_char(date_trunc(...))` | `formatDateTime` / `toDateTime(date_trunc(...))` |

Both modules export a `parseFilters(filters, options)` returning the same-named fragments you interpolate into the SQL string: `filterQuery`, `dateQuery`, `cohortQuery`, `excludeBounceQuery`, `queryParams` — plus `joinSessionQuery` **on the Prisma side only** (ClickHouse needs no join because session columns are denormalized).

Shared helpers on `prisma` default export: `rawQuery`, `writeRawQuery`, `pagedQuery` (model-based), `pagedRawQuery`, `transaction`, `getSearchParameters`, plus SQL-dialect helpers (`getTimestampDiffSQL`, `getDateSQL`, `getDateWeeklySQL`, ...).
ClickHouse default export: `rawQuery`, `pagedRawQuery`, `insert`, `findFirst`, `findUnique`, `connect`, `getUTCString`, `enabled`.

### Exemplars worth reading

| File | Why |
| --- | --- |
| `src/queries/sql/getWebsiteStats.ts` | Full dual implementation, branches on whether event-level filters are present; the no-filter ClickHouse path reads `website_event_stats_hourly` instead of `website_event` |
| `src/queries/sql/events/saveEvent.ts` | The write path: Prisma `websiteEvent.create` vs. ClickHouse `insert('website_event', ...)` / `kafka.sendMessage('event', ...)`; also shows `truncateString(..., FIELD_LENGTH.*)` on every string |
| `src/queries/sql/sessions/getWebsiteSession.ts` | Shows the denormalization gap: Postgres joins `session` + `website_event`; ClickHouse aggregates `website_event_stats_hourly` with `argMax` |
| `src/queries/prisma/website.ts` | Prisma-only module: Zod-validated input, `sanitizeSortFilters`, manual cascade in `deleteWebsiteDependentData` (needed because `relationMode = "prisma"`), Redis invalidation |

## 5. Read replicas

`src/lib/prisma.ts:862-928`:
- With only `DATABASE_URL`: one `PrismaClient` on a `PrismaPg` adapter.
- With `DATABASE_REPLICA_URL` also set: a second client is built and attached via `readReplicas({ replicas: [replicaClient] })` from `@prisma/extension-read-replicas`.
- Raw queries route through `getRawQueryClient(client, { useReplica: !!DATABASE_REPLICA_URL, write })` (`src/lib/prisma.ts:37-65`): `write: true` forces `$primary()`, otherwise `$replica()` is used when available.
- `rawQuery()` is read (replica-eligible); `writeRawQuery()` forces primary. Use `writeRawQuery` for inserts written as raw SQL — see `src/queries/sql/sessions/createSession.ts`.
- The client is stashed on `globalThis[PRISMA]` to survive dev hot-reload; same trick for `globalThis[CLICKHOUSE]`, `globalThis[KAFKA]`, `globalThis[REDIS]`.

## 6. Redis caching

`src/lib/redis.ts` exports `{ client, enabled }` where `enabled = !!process.env.REDIS_URL`. Wrapper methods: `get`, `set` (JSON + `EX`, default TTL 3600s), `del`, `incr`, `expire`, `rateLimit(key, limit, seconds)`, `fetch(key, queryFn, ttl)` (read-through), `remove(key, soft)` (soft delete writes the sentinel `__DELETED__`, which `fetch` maps to `null`).

| Call site | Keys | Notes |
| --- | --- | --- |
| `src/lib/load.ts` | `website:<id>`, `session:<id>` | Read-through with 86400s TTL; falls back to direct query when Redis is off |
| `src/lib/load.ts` | `account:<userId>`, `team:<teamId>` | Plain `get`, no fallback — these are populated elsewhere |
| `src/queries/prisma/website.ts:217,262` | `website:<id>` | `set` on update, `del` on delete |
| `src/queries/prisma/user.ts:153-156`, `team.ts:180-183` | `link:<slug>`, `pixel:<slug>` | Invalidated when a user/team is deleted |
| `src/lib/auth.ts`, `src/app/api/auth/{login,logout,sso}`, `src/app/api/2fa/verify` | auth tokens / rate limits | |
| `src/app/(collect)/p/[slug]`, `q/[slug]`, `src/app/api/share/[slug]` | pixel/link/share slug lookups | |

## 7. Kafka

`src/lib/kafka.ts`. `enabled = KAFKA_URL && KAFKA_BROKER`. `KAFKA_URL` supplies SASL credentials (mechanism from `KAFKA_SASL_MECHANISM`, default `plain`; TLS verification off only with `KAFKA_SSL_ALLOW_UNAUTHORIZED=true`); `KAFKA_BROKER` is a comma-separated broker list.

- `sendMessage(topic, message)` batches by byte size up to `KAFKA_MAX_MESSAGE_BYTES` (default 900 000). Oversized single messages are **logged and dropped**, not retried.
- `acks: 1`, 3s send timeout, 5s connect timeout. All errors are swallowed and logged as `KAFKA ERROR:` — `sendMessage` returns `[]`.
- Topics produced: `event`, `event_data`, `session_data`, `session_link`, `session_replay`, `heatmap_event` (grep `sendMessage(` under `src/queries/sql/`).
- Consumption into ClickHouse is **out of scope for this repo** — nothing here reads these topics.

## 8. Migrations and seeding

```bash
pnpm build-db          # prisma generate  +  esbuild bundle of the client
pnpm build-db-client   # prisma generate only
pnpm update-db         # prisma migrate deploy  (apply pending migrations)
pnpm check-db          # env check -> connect -> version check -> migrate deploy
pnpm seed-data         # tsx scripts/seed-data.ts  (30 days of demo data)
pnpm seed-data -- --days 90 --clear --verbose
```

- Postgres migrations: 24 numbered dirs in `prisma/migrations/` (`01_init` ... `24_lowercase_username`). `01_init` also inserts the default `admin` user (bcrypt hash of `umami`).
- `scripts/check-db.js` runs `prisma migrate deploy` itself, using `DIRECT_DATABASE_URL` when set (for poolers). Skip with `SKIP_DB_MIGRATION=1`; skip the whole check with `SKIP_DB_CHECK=1`.
- ClickHouse has **no migration runner**. Apply `db/clickhouse/schema.sql` then the numbered files in `db/clickhouse/migrations/` by hand.
- One-off backfills live in `db/postgresql/data-migrations/` (`populate-revenue-table.sql`, `convert-utm-clid-columns.sql`) and are also run manually.
- `pnpm build-db-schema` = `prisma db pull` — pulls DB state *into* the schema file; not part of the normal forward workflow.
- Seeder (`scripts/seed-data.ts` -> `scripts/seed/index.ts`): Prisma-only, batches of 1000 via `createMany({ skipDuplicates: true })`. It requires an existing `role: 'admin'` user and creates two demo websites ("Demo Blog", "Demo SaaS") owned by it. Generators live in `scripts/seed/{generators,distributions,sites}/`.

## 9. Gotchas

- **`src/lib/sql.ts` is an empty 0-byte file** and is imported by nothing. Don't put shared SQL helpers there expecting them to be wired up.
- **`relationMode = "prisma"`** means no DB foreign keys. Deletes must cascade manually — see `deleteWebsiteDependentData` in `src/queries/prisma/website.ts`, which even drops to `$executeRawUnsafe` to clean legacy `event_data` rows whose duplicated `websiteId` drifted from the parent event.
- **`runQuery` supports a `[KAFKA]` key that no query module uses.** Kafka is selected *inside* the `clickhouseQuery` branch (`if (kafka.enabled) sendMessage(...) else insert(...)`), e.g. `src/queries/sql/events/saveEvent.ts:263-267`.
- **`createSession` has no ClickHouse branch** — it is Prisma-only and the caller gates it: `src/app/api/send/route.ts:163` only calls it when `!clickhouse.enabled`. In ClickHouse mode session attributes ride on each `website_event` row.
- **ClickHouse reads often target `website_event_stats_hourly`, not `website_event`.** If a query has event-level filters it falls back to raw `website_event`; check which branch you're in before adding a column (`getWebsiteStats.ts` shows both).
- **`session_data` is `ReplacingMergeTree`** — ClickHouse queries must use `FINAL` (`src/lib/clickhouse.ts` uses `from session_data final`) or you read duplicates.
- **Schema-qualified Postgres:** if `DATABASE_URL` has a `?schema=` param, `executeRawQuery` emits `SET search_path TO "<schema>";` before every raw query (`src/lib/prisma.ts:717-750`). Raw SQL written outside that helper will miss it.
- **`BigInt.prototype.toJSON` is monkey-patched globally** in `src/lib/db.ts:8-10` so counts serialize; importing `@/lib/db` has that side effect.
- `DATABASE_TYPE` is referenced only in `scripts/check-env.js` to skip the `DATABASE_URL` check — `getDatabaseType()` ignores it entirely.
- `LOG_QUERY=1` turns on SQL logging in both `src/lib/prisma.ts` and `src/lib/clickhouse.ts` (`debug` namespaces `umami:prisma`, `umami:clickhouse`, `umami:kafka`, `umami:redis-client`).
- `pagedRawQuery` interpolates `orderBy` directly into the SQL string in both engines — callers must whitelist it (see `sanitizeSortFilters` usage in `src/queries/prisma/website.ts`).
