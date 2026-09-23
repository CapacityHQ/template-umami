# Tracker, Recorder & Event Ingestion

How data gets from a visitor's browser into Postgres/ClickHouse. All paths are repo-relative.

## 1. Tracker script

Source: `src/tracker/index.ts` (single IIFE, no deps). Public types: `src/tracker/index.d.ts` (generated).

Install snippet (produced by `src/app/(main)/websites/[websiteId]/settings/WebsiteTrackingCode.tsx`):

```html
<script defer src="https://your-umami/script.js" data-website-id="<uuid>"></script>
```

The script reads its config from `document.currentScript` attributes and **returns immediately if `document.currentScript` is null** (`src/tracker/index.ts:224`), so injecting it without a real script element is a no-op.

### `data-*` attributes (script tag)

| Attribute | Default | Effect |
| --- | --- | --- |
| `data-website-id` | — | Required website UUID. Without it `trackingDisabled()` is true and nothing is sent. |
| `data-host-url` | script's own dir | Base URL for the collect endpoint. Precedence: attribute → `__COLLECT_API_HOST__` build constant → `currentScript.src` directory. |
| `data-auto-track` | `true` | `"false"` skips all auto-init: no initial pageview, no history hooks, no click handler, no perf. `window.umami.track()` still works. |
| `data-auto-pageview` | `true` | `"false"` keeps click/history hooks but suppresses the initial and SPA-route pageviews. |
| `data-tag` | — | Free-form string attached to every event as `tag` (max 50 chars server-side). |
| `data-do-not-track` | off | `"true"` honors `navigator.doNotTrack` / `msDoNotTrack` / `window.doNotTrack` (`1`, `'1'`, `'yes'`). Off by default — DNT is **ignored** unless you opt in. |
| `data-domains` | — | Comma-separated hostname allowlist; tracking disabled when `location.hostname` isn't in it. |
| `data-exclude-search` | off | `"true"` strips `?query` from `url` and `referrer` before sending. |
| `data-exclude-hash` | off | `"true"` strips `#hash`. |
| `data-fetch-credentials` | `omit` | Passed to `fetch()` as `credentials`. |
| `data-before-send` | — | Name of a **global** function `window[name](type, payload)`; return a payload (sync or Promise), or `null`/`undefined` to drop the event. |
| `data-performance` | off | `"true"` enables Web Vitals collection (`initPerformance`, `src/tracker/index.ts:463`). |

Element-level attributes (auto-click tracking, `handleClicks`):

| Attribute | Effect |
| --- | --- |
| `data-umami-event="name"` | Any click on the element (or a descendant — matched via `closest()`) fires `track(name, data)`. |
| `data-umami-event-<key>="value"` | Collected into the event `data` object; key regex `data-umami-event-([\w-_]+)`. |

For `<a data-umami-event>` with an `href`, navigation is deferred: the click is `preventDefault()`ed, the event is sent, then `location.href` is set in `.finally()` — unless the click is external (`target="_blank"`, ctrl/shift/meta, middle click).

### `window.umami` API

| Call | Behavior |
| --- | --- |
| `umami.track()` | Pageview with the default payload. |
| `umami.track('name')` | Custom event, default payload + `name`. |
| `umami.track('name', {…})` | Custom event with `data`. |
| `umami.track({…})` | Replaces the payload entirely (must include `website`). |
| `umami.track(props => ({…props}))` | Payload transformer; return value is sent as-is. |
| `umami.identify(id, data?)` / `umami.identify({id, …})` | Sends `type: 'identify'`; sets the in-memory distinct id and **clears the cache token** so the server re-links identity. |
| `umami.getSession()` | `{ cache, website }` — the JWT cache token and website id. Used by the recorder to wait for a session. |

`window.umami` is only assigned if not already present (`if (!window.umami)`), so a stub/queue defined before load wins.

### Auto-tracking behavior

- Init runs on `document.readyState === 'complete'` (or a `readystatechange` listener).
- SPA routing: `history.pushState`/`replaceState` are monkey-patched (`handlePathChanges`); on a URL change the previous URL becomes the referrer and a pageview is sent after a 300 ms delay.
- Same-origin referrers are reduced to a path by `stripOrigin`, so the referrer domain is never sent for internal navigation.
- Kill switch: `localStorage['umami.disabled']` disables the tracker on that browser.

### Transport

`send()` POSTs JSON `{ type, payload }` with `keepalive: true` to the endpoint, headers: `Content-Type`, `x-umami-website-id`, `x-umami-hostname`, and `x-umami-cache` (once a token exists). The response `{ cache, disabled }` is stored in memory; `disabled: true` permanently stops sending for the page.

## 2. Build pipeline

| Command | Does | Output |
| --- | --- | --- |
| `npm run check-tracker` | `tsc -p tsconfig.tracker.json --noEmit` (strict typecheck only) | — |
| `npm run build-tracker-script` | `rollup -c rollup.tracker.config.js` (typescript → replace → terser, IIFE) | `public/script.js` |
| `npm run build-tracker-types` | `tsc -p tsconfig.tracker.types.json` + biome format | `src/tracker/index.d.ts` |
| `npm run build-tracker` | all three above | — |
| `npm run build-recorder` | `rollup -c rollup.recorder.config.js` (resolve + commonjs to bundle rrweb) | `public/recorder.js` |
| `npm run build-geo` | `scripts/build-geo.js` | `geo/GeoLite2-City.mmdb` |
| `npm run build` | check-env → build-db → check-db → build-tracker → build-recorder → build-geo → build-app | — |

Build-time string replacement (`@rollup/plugin-replace`, empty delimiters — raw token substitution, not macros):

- `__COLLECT_API_HOST__` ← `process.env.COLLECT_API_HOST` (default `''`)
- `__COLLECT_API_ENDPOINT__` ← `process.env.COLLECT_API_ENDPOINT` (default `/api/send`) — tracker only

`scripts/update-tracker.js` (`npm run update-tracker`, part of `start-docker`) patches the **already-built** `public/script.js`, replacing every literal `/api/send` with `COLLECT_API_ENDPOINT`. That's how a prebuilt Docker image retargets the endpoint at container start.

### Serving

`public/script.js` and `public/recorder.js` are gitignored build artifacts served as static files. `next.config.ts` adds:

- Production `Cache-Control: public, max-age=86400, must-revalidate` + `Access-Control-Allow-Origin: *` on both scripts.
- `TRACKER_SCRIPT_NAME` (comma-separated) → rewrites each alias path to `/script.js` (ad-blocker evasion).
- `TRACKER_SCRIPT_URL` → rewrites `/script.js` to an external URL.
- `COLLECT_API_ENDPOINT` → rewrite of that path to `/api/send` plus API CORS headers.
- `UMAMI_SELF_TRACK` / `UMAMI_SELF_RECORD` → the dashboard loads its own scripts (`src/app/(main)/App.tsx:88-105`).

## 3. Collect endpoints

| Route | File | Purpose |
| --- | --- | --- |
| `POST /api/send` | `src/app/api/send/route.ts` | Main collect endpoint: `event`, `identify`, `performance`. |
| `POST /api/record` | `src/app/api/record/route.ts` | Replay chunks (`record`) and heatmap events (`heatmap`). |
| `GET /q/:slug` | `src/app/(collect)/q/[slug]/route.ts` | Short link: logs a link event, then 302 to `link.url`. |
| `GET /p/:slug` | `src/app/(collect)/p/[slug]/route.ts` | Tracking pixel: logs a pixel event, returns a 1×1 GIF with no-store headers. |
| `GET /api/websites/:id/recorder` | `src/app/api/websites/[websiteId]/recorder/route.ts` | Unauthenticated recorder config (sample rates, mask level, …), cached 60 s. |

`/q` and `/p` do not reimplement ingestion: they build a synthetic `Request` that reuses the original headers (so IP/UA resolution still works) and call `POST` from `@/app/api/send/route` directly, then redirect / return the GIF.

### `/api/send` payload schema

`{ type, payload }`, validated by Zod. Exactly one of `website`, `link`, `pixel` must be present.

| Field | Type | Notes |
| --- | --- | --- |
| `type` | `'event' \| 'identify' \| 'performance'` | required |
| `payload.website` / `link` / `pixel` | uuid | exactly one; becomes `sourceId` |
| `payload.url`, `payload.referrer` | url or path | validated with `urlOrPathParam` (`src/lib/schema.ts:107`) |
| `payload.hostname`, `language`, `screen`, `title` | string | |
| `payload.name` | string | event name; rejected if it starts with `= + - @ TAB CR` (CSV-formula guard) |
| `payload.tag` | string | same formula guard |
| `payload.data` | object | event data / identify traits |
| `payload.id` | string | distinct (visitor) id |
| `payload.ip`, `userAgent`, `browser`, `os`, `device` | string | server-side overrides, **trusted if present** |
| `payload.timestamp` | int (seconds) | backdating; when set, the 30-min visit expiry is skipped |
| `payload.lcp`, `inp`, `fcp`, `ttfb` | number ≤ 60000 | performance type |
| `payload.cls` | number ≤ 100 | performance type |

Response: `{ cache, sessionId, visitId }` where `cache` is a JWT (`createToken`, `src/lib/jwt.ts`) signed with `secret()` containing `{ websiteId, sessionId, visitId, iat, sessionLinkId, type: 'cache' }`.

## 4. Ingestion sequence (end to end)

1. **Parse** — `parseRequest(request, schema, { skipAuth: true })` (`src/lib/request.ts:16`) reads the JSON body and runs the Zod schema; failures return 400 with `z.treeifyError`.
2. **Cache token** — if `x-umami-cache` is present, `parseToken(header, secret())` verifies it and reuses `sessionId`/`visitId`/`iat`/`sessionLinkId`.
3. **Website lookup** — only when there is no cached `websiteId`: `fetchWebsite()` (`src/lib/load.ts:6`), Redis-backed for 24 h when `REDIS_URL` is set. Unknown website → 400.
4. **Client info** — `getClientInfo(request, payload)` (`src/lib/detect.ts:136`):
   - UA = `payload.userAgent` or the `user-agent` header.
   - IP = `payload.ip` or `getIpAddress(headers)` (`src/lib/ip.ts:75`) walking `CLIENT_IP_HEADER`, `true-client-ip`, `cf-connecting-ip`, `x-real-ip`, `x-forwarded-for` (first entry), `forwarded`, … normalized with `ipaddr.js` (IPv4-mapped IPv6 collapsed, port stripped).
   - Geo = `getLocation()`: skipped for local/invalid IPs; first tries CDN headers (Cloudflare / Vercel / CloudFront / EdgeOne, unless `SKIP_LOCATION_HEADERS`), else opens `geo/GeoLite2-City.mmdb` via `maxmind` and caches the reader on `globalThis`. Region is normalized to `US-CA` form.
   - `browser` = `browserName()` and `os` = `detectOS()` from `detect-browser`; `device` = `getDevice()` using `ua-parser-js` plus a screen-width heuristic (desktop with width ≤ 1920 → `laptop`).
5. **Bot check** — `isbot(userAgent)` (unless `DISABLE_BOT_CHECK`) → returns **HTTP 200** `{ beep: 'boop' }` and stops.
6. **IP block** — `hasBlockedIp(ip)` matches `IGNORE_IP` (exact or CIDR) → 403.
7. **Salts** — `sessionSalt = getSalt(SALT_ROTATION|'month', createdAt)`, `visitSalt = hash(startOfHour(createdAt).toUTCString())` (`src/lib/crypto.ts:72`).
8. **Session id** — `sessionId = uuid(sourceId, ip, userAgent, sessionSalt)` = `uuidv5(sha512(args + secret()), DNS)`. Deterministic, cookie-less (`src/lib/session.test.ts`).
9. **Session row** — relational mode only: `createSession()` (`insert … on conflict (session_id) do nothing`). ClickHouse mode stores session columns on every event row instead. A "session drift" (cached session id ≠ recomputed one, e.g. salt rotation or IP change) forces a session re-insert and a fresh visit.
10. **Visit id** — `uuid(sessionId, visitSalt)`, rotated when `now - iat > 1800` (30 min) and no explicit `timestamp`.
11. **Per type**
    - `event`: parses the URL against `https://<hostname>`, splits path/query/hash, extracts `utm_*` and click ids (`gclid`, `fbclid`, `msclkid`, `ttclid`, `li_fat_id`, `twclid`), drops a self-referral `referrerDomain`, picks `eventType` (`link=3`, `pixel=4`, `name→custom=2`, else `pageView=1`) and calls `saveEvent`.
    - `identify`: if `website` and `id` and `hash(sessionId, id) !== cache.sessionLinkId`, runs `saveSessionLink` + `updateSession` (failures logged, not fatal); then `saveSessionData(data)`.
    - `performance`: `saveEvent` with `eventType 5` and `lcp/inp/cls/fcp/ttfb`.
12. **Write** — `runQuery` (`src/lib/db.ts:26`) picks the backend: `CLICKHOUSE_URL` set → ClickHouse (or Kafka topic `event` / `event_data` / `session_data` / `session_replay` when `KAFKA_URL` + `KAFKA_BROKER` are set), otherwise Prisma/Postgres. Every string is truncated to `FIELD_LENGTH` (`src/lib/constants.ts:272`).
13. **Respond** — a fresh cache JWT is returned; the tracker replays it on the next request.

### Event data storage

`src/lib/data.ts` flattens the `data` object: nested objects become dotted keys (`flattenJSON`), values are typed via `DATA_TYPE` (string 1, number 2, boolean 3, date 4, array 5). Arrays are JSON-stringified; a stringified array longer than 500 chars is stored as `null` (`getStoredStringValue`). Numbers are stored with 4 decimal places in the string column. Rows go to `event_data` / `session_data`; `session_data` upserts on `(session_id, data_key)`. `saveEvent` also writes a revenue row when `data.revenue > 0 && data.currency` (relational path only).

## 5. Recorder & replay

- Source `src/recorder/index.js` → `public/recorder.js`; install identically to the tracker (`data-website-id`, optional `data-host-url`). Requires the main tracker on the page: it polls `window.umami.getSession().cache` (50 × 100 ms) and only sends with a valid token.
- On load it fetches `/api/websites/<id>/recorder`. If `enabled` is false it exits. Defaults: `sampleRate` 0.15, `heatmapSampleRate` 0.15, `maskLevel` `moderate`, `maxDuration` 300000 ms, `blockSelector` ''. Sampling is per page load (`Math.random() <= rate`).
- Replay: `rrweb.record()` with `maskAllInputs: true` always (`maskLevel: 'strict'` also sets `maskTextSelector: '*'`), `inlineStylesheet: true`, `recordCanvas: false`, `recordCrossOriginIframes: false`, `checkoutEveryNms: 30000`, slimDOM stripping scripts/comments/meta. Buffer flushes every 2 s or 100 events; recording stops after `maxDuration`.
- Payload size is capped at 500 KB client-side; oversized single events (typically full snapshots) are binary-search split into `umami:rrweb-event-fragment` chunks. `src/lib/replay.ts` (`restoreReplayEventFragments`, `getReplayEventCount`) reassembles them on read; fragments count as one event.
- Heatmap: click and scroll-depth events (`HEATMAP_EVENT_TYPE` 1/2), flushed every 5 s or 20 events, with page/viewport dimensions and scroll percentage.
- `/api/record` enforces ≤ 1 MB bodies (413), ≤ 200 events per array, a valid `x-umami-cache` token (session/visit come from the token, never the body), re-checks `website.recorderEnabled` uncached, re-runs bot/IP checks, and in `CLOUD_MODE` requires a business account. Storage: `saveRecording` gzips the event array into `session_replay.events` on Postgres, stores raw JSON on ClickHouse.

## 6. Privacy model

Cookie-less. The browser stores nothing except the in-memory JWT cache token (and `umami.disabled` if the user opts out) — no cookies, no localStorage identifiers.

**Derived, not stored:**

- `sessionId = uuidv5(sha512(websiteId + ip + userAgent + salt + appSecret))`. The salt is `sha512(startOfMonth|week|day(createdAt).toUTCString())`, rotated by `SALT_ROTATION` (default `month`), so the mapping expires on rotation.
- `visitId = uuidv5(sha512(sessionId + sha512(startOfHour)))`, also rotated after 30 idle minutes.

**Persisted per event/session:** website id, session id, visit id, url path/query, page title, hostname, referrer path/query/domain (self-referrals dropped), UTM params and click ids, event type/name, tag, browser, OS, device class, screen size, language, country/region/city, distinct id (only if you call `identify`), timestamps, plus flattened event/session data key-values.

**Never persisted:** raw IP address, raw user agent string. Both are hash inputs only. There is no cross-site identifier — the website/link/pixel id is part of the hash, so the same visitor gets different session ids on different sites.

## 7. Gotchas

- **`data-cache` is dead.** `src/app/(main)/App.tsx` still sets `data-cache="true"`, but `src/tracker/index.ts` never reads it — response caching is automatic via the `x-umami-cache` token.
- **`data-sample-rate` on the recorder tag is dead too.** The recorder reads only `data-website-id` and `data-host-url`; sampling comes from the server config endpoint.
- **`x-umami-website-id` / `x-umami-hostname` are sent but never read** anywhere in this repo; only `x-umami-cache` matters server-side.
- **The `disabled` kill-switch is never returned** by the OSS `/api/send` route, even though the tracker honors it (cloud-only behavior).
- **Bots get HTTP 200.** `{ beep: 'boop' }` with a 200 status — you cannot detect bot rejection from the status code, and no cache token is returned.
- **`payload.ip` / `userAgent` / `browser` / `os` / `device` are trusted verbatim** on an unauthenticated endpoint. Supplying `ip` also skips CDN geo headers (`skipHeaders`).
- **Event names starting with `=`, `+`, `-`, `@`, tab or CR reject the whole request** with a 400 (CSV-formula-injection guard in `src/app/api/send/route.ts:26`).
- **`data-do-not-track` is opt-in**; DNT headers are ignored by default.
- **No `OPTIONS` handler on `/api/send`** — CORS comes from the `next.config.ts` header rules for `/api/:path*` (and for `COLLECT_API_ENDPOINT` when set). `/api/record` does export `OPTIONS` via `corsPreflight()`.
- **ClickHouse mode never writes a `session` row**; `createSession` is guarded by `!clickhouse.enabled`. Session attributes are denormalized onto each `website_event`.
- **Salt rotation changes session ids mid-flight.** The route detects the drift against the cached token and starts a new visit rather than reusing the stale one.
- **`build-geo` silently skips** on Vercel (unless `BUILD_GEO`) or with `SKIP_BUILD_GEO`, and falls back to a GitHub-hosted GeoLite2 redistribution when `MAXMIND_LICENSE_KEY` is unset.
- **`update-tracker` is a text substitution on the minified bundle** — it replaces every `/api/send` occurrence in `public/script.js`, so it must run after `build-tracker` and is not idempotent across different endpoint values.
