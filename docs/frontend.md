# Frontend Guide (Umami)

Next.js 16 App Router + React 19 + TypeScript. UI is built almost entirely from the
`@umami/react-zen` design system. Path alias `@/*` -> `./src/*` (`tsconfig.json`).
Formatting/linting is Biome (`biome.json`): single quotes, 100 col, 2-space indent,
trailing commas, `organizeImports` on. Run `pnpm check` before finishing.

---

## 1. Component directory map

All shared UI lives under `src/components/`. Screen-specific components live next to their
route in `src/app/(main)/**`.

| Directory | Files | Purpose |
|---|---|---|
| `src/components/common/` | 39 | Generic reusable building blocks: `PageBody`, `PageHeader`, `Panel`, `SectionHeader`, `DataGrid`, `LoadingPanel`, `Empty`, `ErrorBoundary`, `Pager`, `Link`, `LinkButton`, `Avatar`, `Favicon`, `Badge`, `GridRow`, `IconLabel`, `ActionForm`, `ConfirmationForm`, `ControlledDialog`, `OverlayScrollArea`. |
| `src/components/input/` | 41 | Interactive controls and toolbar buttons: `DialogButton`, `MenuButton`, `FilterBar`, `DateFilter`, `WebsiteDateFilter`, `UnitFilter`, `WebsiteSelect`, `UserSelect`, `ThemeModeSelector`, `ExportButton`, `RefreshButton`, `ProfileButton`, `SettingsButton`. |
| `src/components/metrics/` | 18 | Analytics display widgets: `MetricsTable`, `MetricsBar`, `MetricCard`, `ListTable`, `PageviewsChart`, `RealtimeChart`, `EventsChart`, `WorldMap`, `WeeklyTraffic`, `ActiveUsers`, `Legend`. |
| `src/components/charts/` | 6 | chart.js wrappers: `Chart` (base canvas), `BarChart`, `PieChart`, `BubbleChart`, `DistributionBarChart`, `ChartTooltip`. |
| `src/components/hooks/` | 35 + `context/` + `queries/` | All React hooks. Barrel export at `src/components/hooks/index.ts` (`'use client'`). |
| `src/components/property-data/` | 8 | Event/session property filter + chart components (`PropertyChart`, `PropertyFilters`, ...). |
| `src/components/share/` | 5 | Share-link CRUD tables/forms reused across websites/boards/links/pixels. |
| `src/components/modals/` | 5 | Two-factor setup/disable/success modals (only feature modals kept here). |
| `src/components/svg/` | 45 | SVGR-generated custom icons (`Logo`, `Lightning`, `Funnel`, `Gauge`, ...). Regenerate with `pnpm build-icons`. |
| `src/components/icons.ts` | 1 line | `export * from 'lucide-react';` — the standard icon source. |
| `src/components/messages.ts` | ~510 lines | `labels` and `messages` maps: JS identifier -> i18n key string. |

`src/index.ts` is a separate barrel used only to build the published `@umami/components`
package (`pnpm build-components`, `tsup.config.js`). It is **not** the app's import path.

---

## 2. `@umami/react-zen` — the design system

- Version pinned in `package.json` (`^0.249.0`). Docs: https://zen.umami.is
- Global CSS imported once in `src/app/layout.tsx`: `import '@umami/react-zen/styles.full.css';`
- Providers wired in `src/app/Providers.tsx`: `<ZenProvider><RouterProvider>…`.
- **325 files under `src/` import from it.** Prefer it over hand-rolled markup/CSS.

Most-used primitives (import count across `src/`):

| Primitive | Uses | Notes |
|---|---|---|
| `Column` / `Row` | 157 / 149 | Flexbox layout. Props: `gap`, `padding*`, `margin*`, `alignItems`, `justifyContent`, `width`, `border`. Responsive object values supported (`{ base: …, md: … }`). |
| `Text` | 109 | Typography; `color="muted"`, `weight="bold"`, `truncate`. |
| `Button` | 104 | Uses `onPress` (react-aria), **not** `onClick`. `variant="primary" \| "quiet" \| "zero"`. |
| `Icon` | 94 | Wraps an SVG child: `<Icon size="md" color="muted"><Plus /></Icon>`. |
| `Grid` | 51 | `columns={{ base: '1fr', md: '1fr 1fr' }}`. |
| `DataTable` / `DataColumn` | 22 each | Table rendering; column children are render functions `(row) => ReactNode`. |
| `Form` / `FormField` / `FormSubmitButton` / `FormButtons` | 29/29/29/20 | Form stack with `rules={{ required, pattern }}` validation. |
| `Dialog` / `Modal` / `DialogTrigger` | 31/28/22 | Usually accessed via `@/components/input/DialogButton`. |
| `Select`, `TextField`, `ListItem`, `Menu`/`MenuItem`, `Tabs`/`Tab`/`TabPanel`, `Tooltip`/`TooltipTrigger`, `Loading`, `Heading`, `Label`, `Popover`, `Switch`, `Checkbox`, `SearchField`, `PasswordField`, `Alert`, `StatusLight` | — | Available; use instead of raw HTML. |
| `useTheme`, `useToast`, `useBreakpoint`, `useDebounce` | — | Zen hooks. `useTheme` is a zustand store: `{ theme, palette, setTheme, setPalette, syncTheme, initTheme, initPalette }`. |

**Rule for agents:** build new UI out of zen primitives + `src/components/common` wrappers.
Only reach for raw `<div>`/inline styles when a zen prop genuinely doesn't exist (the codebase
does this sparingly, e.g. `style={{ margin: '0 auto' }}` in `PageBody.tsx`).

---

## 3. Styling

- **CSS Modules are the exception, not the rule** — only 11 `*.module.css` files exist in the
  whole repo. Everything else is zen props.
- Naming: `Component.module.css` sits next to `Component.tsx`; class names are lowercase
  single words (`.badge`, `.dot`, `.good`), applied as `styles.badge`. See
  `src/components/common/Badge.module.css` + `Badge.tsx`.
- Global stylesheet: `src/app/global.css` (105 lines). Contains `--font-family`,
  `--primary`/`--primary-foreground` overrides, autofill fixes, and `rrweb-player` overrides.
  Font is `next/font/google` Inter, exposed as `--font-inter`.
- PostCSS: `postcss.config.js` — `postcss-flexbugs-fixes` + `postcss-preset-env` stage 3 with
  `custom-properties: false` (CSS variables pass through untouched).
- **Design tokens** come from zen's stylesheet: `var(--text-primary)`, `var(--text-muted)`,
  `var(--surface-base)`, `var(--surface-raised)`, `var(--surface-sunken)`. Use these instead of
  literal colors in any CSS module you write.
- **Dark mode** is driven by zen: `useTheme()` sets `data-theme="light|dark"` on `<html>` and
  persists to `localStorage` key `"theme"` (zen's own key). In a CSS module, target it with
  `:global([data-theme="dark"]) .good { … }` (see `Badge.module.css`).
- Chart/map colors are **not** CSS variables — `src/lib/colors.ts` `getThemeColors(theme)` reads
  `THEME_COLORS` from `src/lib/constants.ts` (`light`/`dark` -> `primary/text/line/fill`) and
  returns `{ colors: { theme, chart: { text, line, views, visitors }, map } }` with colord-derived
  alpha variants. `CHART_COLORS` (12 hexes) is the categorical palette. `getColor(seed)` gives a
  deterministic FNV-1a-hashed color for arbitrary strings.

---

## 4. State — zustand stores

Stores are created with bare `create(() => ({...}))` and mutated through **exported module-level
functions**, not via hook setters. `immer`'s `produce` is used for nested updates.

| Store | File | Shape | Mutators |
|---|---|---|---|
| `useApp` | `src/store/app.ts` | `{ locale, theme, timezone, dateRangeValue, share, shareToken, user, config }` — locale/theme/timezone/dateRange seeded from `localStorage` via `getItem`. | `setLocale`, `setTimezone`, `setDateRangeValue`, `setShareData`, `setUser`, `setConfig` |
| `useDashboard` | `src/store/dashboard.ts` | `{ showCharts, limit, websiteOrder[], websiteActive[], editing, isEdited }`, hydrated from `DASHBOARD_CONFIG` localStorage key. | `saveDashboard(settings)` (also persists) |
| `useWebsites` | `src/store/websites.ts` | `{ [websiteId]: { dateRange: {…, modified}, dateCompare } }` | `setWebsiteDateRange`, `setWebsiteDateCompare` |
| `useVersion` | `src/store/version.ts` | `{ current, latest, hasUpdate, checked, releaseUrl }` | `checkVersion()` (fetches `UPDATES_URL`, compares with `semver.gt`) |
| `useCache` | `src/store/cache.ts` | free-form `{ [key]: any }` | `setValue(key, value)` |

Two more ad-hoc zustand stores live outside `src/store/`:

- `src/components/hooks/useModified.ts` — `{ [key]: timestamp }`; `touch(key)` bumps it. This is
  the project's primary cache-busting mechanism (used ~62 times) — query hooks include
  `modified` in their `queryKey`, so `touch('websites')` refetches.
- `src/components/hooks/useGlobalState.ts` — `useGlobalState(key, initial)` returns
  `[value, setValue]` backed by a global store.

---

## 5. Data fetching

Stack: `@tanstack/react-query` v5. Client configured in `src/app/Providers.tsx`:
`retry: false`, `refetchOnWindowFocus: false`, `staleTime: 60_000`.

Layers, bottom-up:

1. `src/lib/fetch.ts` — thin `fetch` wrapper: `request()`, `httpGet/httpPost/httpPut/httpDelete`.
   Always `cache: 'no-cache'`, JSON headers. Returns `{ ok, status, data }`.
2. `src/lib/api-url.ts` — `getApiUrl(url)` resolves a relative path against
   `process.env.apiUrl` / `process.env.basePath`. `/auth/*` and `/config/*` are forced to the
   local app route even when `apiUrl` is set (`APP_ROUTE_PATTERNS`).
3. `src/lib/client.ts` — auth token in localStorage: `getClientAuthToken`,
   `setClientAuthToken`, `removeClientAuthToken` (key `AUTH_TOKEN`).
4. `src/components/hooks/useApi.ts` — returns `{ get, post, put, del, useQuery, useMutation }`.
   Injects `authorization: Bearer <token>` plus share headers (`SHARE_TOKEN_HEADER`,
   `SHARE_CONTEXT_HEADER`) when a share context is active. Rejects non-ok responses with an
   `Error` carrying `{ code, status }`.
5. `src/components/hooks/queries/*` — ~75 feature query hooks, all re-exported from
   `@/components/hooks`.

Pattern to copy for a new query hook (`queries/useWebsiteQuery.ts`):

```ts
const { get, useQuery } = useApi();
const { modified } = useModified(`website:${websiteId}`);
return useQuery({
  queryKey: ['website', { websiteId, modified }],
  queryFn: () => get(`/websites/${websiteId}`),
  enabled: !!websiteId,
  placeholderData: keepPreviousData,
  ...options,
});
```

Mutations use the generic `useUpdateQuery(path, params)` (POST, returns
`{ mutateAsync, error, isPending, touch, toast }`) and `useDeleteQuery(path, params)`.
`queryClient.invalidateQueries` is used in only ~8 places (mostly 2FA); prefer `touch()`.

### Hooks reference (most useful)

| Hook | File | Returns |
|---|---|---|
| `useApi` | `hooks/useApi.ts` | `{ get, post, put, del, useQuery, useMutation }` — auth + share headers applied |
| `useMessages` | `hooks/useMessages.ts` | `{ t, messages, labels, getMessage, getErrorMessage }` |
| `useNavigation` | `hooks/useNavigation.ts` | `{ router, pathname, searchParams, query, teamId, websiteId, linkId, pixelId, boardId, updateParams, replaceParams, renderUrl }` (ids parsed from pathname) |
| `useLocale` | `hooks/useLocale.ts` | `{ locale, saveLocale, messages, dir, dateLocale }` — lazy-loads `/intl/messages/<locale>.json` |
| `useFormat` | `hooks/useFormat.ts` | `{ formatOS, formatBrowser, formatDevice, formatCountry, formatRegion, formatCity, formatLanguage, formatValue }` |
| `useDateRange` | `hooks/useDateRange.ts` | `{ date, unit, offset, compare, isAllTime, isCustomRange, dateRange, dateCompare }` from URL query |
| `useDateParameters` | `hooks/useDateParameters.ts` | UTC-normalized `startAt`/`endAt`/`unit`/`timezone` for API params |
| `useFilterParameters` | `hooks/useFilterParameters.ts` | filter query params extracted from the URL (respects share `allowFilter`) |
| `usePageParameters` | `hooks/usePageParameters.ts` | `{ page, pageSize, search, orderBy, sortDescending }` |
| `usePagedQuery` | `hooks/usePagedQuery.ts` | react-query result of `PageResult<T>`, auto-appends paging params to `queryKey` |
| `useModified` | `hooks/useModified.ts` | `{ modified, touch }` — cache-bust key |
| `useConfig` | `hooks/useConfig.ts` | `Config` (`cloudMode`, `privateMode`, `linksUrl`, `trackerScriptName`, …), auto-fetches `/config` |
| `useLoginQuery` | `queries/useLoginQuery.ts` | current `{ user, isLoading, error }` |
| `useMobile` | `hooks/useMobile.ts` | `{ breakpoint, isMobile, isPhone }` (wraps zen `useBreakpoint`) |
| `useTimezone` | `hooks/useTimezone.ts` | `{ timezone, saveTimezone, formatTimezoneDate, localToUtc, … }` |
| `useFields` / `useFilters` / `useOperatorLabels` | `hooks/…` | filterable field definitions, filter operators, translated operator labels |
| `useSubscription` | `hooks/useSubscription.ts` | cloud plan + feature gating (`replays` -> `isBusiness`) |
| `useSticky` | `hooks/useSticky.ts` | `{ ref, isSticky }` via IntersectionObserver |
| `useEscapeKey`, `useDocumentClick`, `useForceUpdate`, `useSlug`, `useCountryNames`, `useLanguageNames`, `useRegionNames` | `hooks/…` | small utilities |
| Context hooks | `hooks/context/*` | `useWebsite`, `useTeam`, `useUser`, `useShare`, `useBoard`, `useLink`, `usePixel` — read the corresponding `*Provider` React context |

---

## 6. Charts

- `src/components/charts/Chart.tsx` is the single `chart.js/auto` canvas wrapper. It sets
  `ChartJS.defaults.font.family = 'Inter'`, disables the built-in legend/tooltip
  (`tooltip.enabled: false`, `external: onTooltip`) and renders `@/components/metrics/Legend`
  itself. Props: `type`, `chartData`, `chartOptions`, `updateMode`, `animationDuration`,
  `onTooltip`, `hiddenLabels`, `onLegendClick`.
- `BarChart.tsx` wraps `Chart` with time-series axes, `ChartTooltip`, locale-aware date formats,
  and `getThemeColors(theme)`.
- `PageviewsChart.tsx` is the canonical consumer: builds `datasets` from
  `generateTimeSeries(...)` + `colors.chart.visitors` / `colors.chart.views`, plus optional
  `compare` line datasets.
- `src/lib/charts.ts` exports only two axis-label renderers: `renderNumberLabels(label)` and
  `renderDateLabels(unit, locale)`.
- `chartjs-adapter-date-fns` is imported once, in `src/app/Providers.tsx`.

---

## 7. i18n

- Library: `next-intl` 4.x, wired by `createNextIntlPlugin('./src/i18n/request.ts')` in
  `next.config.ts`.
- `src/i18n/request.ts` hardcodes server locale to `en-US` with the bundled `en-US.json`.
  Runtime locale switching is entirely client-side: `MessagesProvider` in
  `src/app/Providers.tsx` feeds `NextIntlClientProvider` from `useLocale()`, which lazily
  `httpGet`s `/intl/messages/<locale>.json` from `public/`.
- Message files: `public/intl/messages/*.json` — **52 locales**, nested
  `{ "label": {...}, "message": {...} }`. Companion data: `public/intl/country/*.json`,
  `public/intl/language/*.json`, `public/iso-3166-2.json`.
- Components never use raw key strings. They use the constant maps in
  `src/components/messages.ts`: `t(labels.websites)` where `labels.websites = 'label.websites'`.

### Adding a new translated string

1. Add the English copy to `public/intl/messages/en-US.json` under `label` or `message`,
   kebab-case key, alphabetical order (e.g. `"label": { "new-thing": "New thing" }`).
2. Add the camelCase alias in `src/components/messages.ts`:
   `newThing: 'label.new-thing'` (in `labels`) or `... : 'message.new-thing'` (in `messages`).
3. Use it: `const { t, labels } = useMessages(); … {t(labels.newThing)}`.
4. Verify coverage: `pnpm check-missing-messages` (reports per-locale missing/extra keys;
   `node scripts/check-missing-messages.js --remove-extra-keys` prunes stale keys).
5. Do not hand-translate the other 51 files — the script only reports; translations land
   separately.

API error codes are translated automatically: `getErrorMessage(error)` maps `error.code` to
`message.<code>`.

---

## 8. Display formatting conventions

- `src/lib/format.ts`: `parseTime`, `formatTime` (`h:mm:ss`), `formatShortTime(val, ['m','s'])`
  (`3m20s`), `formatNumber`, `formatLongNumber` (`1.2m`, `340k`), `formatCurrency`,
  `formatLongCurrency`, `stringToColor`, `decodePunycodeDomain` (use before showing any domain),
  `truncateString`.
- `src/lib/date.ts`: `DATE_FORMATS` (unit -> pattern), `DATE_FUNCTIONS`, `TIME_UNIT`,
  `formatDate(date, pattern = 'PPpp', locale)`, `parseDateRange`, `getOffsetDateRange`,
  `getCompareDate`, `getMinimumUnit`, `getAllowedUnits`, `generateTimeSeries`, `getTimezone`,
  `normalizeTimezone`, `isValidTimezone`.
- Use `formatDate` / `useTimezone().formatTimezoneDate` — never `toLocaleString` directly.
  Ready-made components: `common/DateDisplay.tsx`, `common/DateDistance.tsx`.

---

## 9. How to build a new screen — checklist

1. **Route file** `src/app/(main)/<area>/page.tsx` — a *server* component. Awaits `params`,
   renders the client page component, exports `metadata`.
   Copy: `src/app/(main)/websites/page.tsx` (or
   `src/app/(main)/settings/websites/page.tsx` for the `params` variant).
2. **Client page** `src/app/(main)/<area>/<Name>Page.tsx` — starts with `'use client'`.
   Copy: `src/app/(main)/websites/WebsitesPage.tsx`.
   Shell: `<PageBody>` -> `<Column gap="6">` -> `<PageHeader title={t(labels.x)}>{actions}</PageHeader>`
   -> `<Panel>` -> content. For nested/settings screens use `<SectionHeader>` instead
   (`settings/websites/WebsitesSettingsPage.tsx`).
3. **Data** — add/reuse a hook in `src/components/hooks/queries/`, export it from
   `src/components/hooks/index.ts`. Copy `useWebsiteQuery.ts` (single) or `useWebsitesQuery.ts`
   (paged). Import from `@/components/hooks`, never the deep path.
4. **List/table** — `<DataGrid query={queryResult} allowSearch allowPaging>{({ data }) => …}</DataGrid>`
   wrapping a zen `<DataTable>` of `<DataColumn>`s.
   Copy: `src/app/(main)/websites/WebsitesDataTable.tsx` + `WebsitesTable.tsx`.
   `DataGrid` handles search debounce, URL sync, paging, loading, empty state.
5. **Loading/empty/error for non-grid content** — wrap in
   `<LoadingPanel data isLoading isFetching error renderEmpty>` (`common/LoadingPanel.tsx`).
6. **Forms** — zen `<Form onSubmit>` + `<FormField name rules>` + `<TextField>` +
   `<FormSubmitButton>`. Copy: `src/app/(main)/websites/WebsiteAddForm.tsx`.
7. **Dialogs** — `@/components/input/DialogButton` (handles mobile fullscreen + controlled mode).
   Copy: `src/app/(main)/websites/WebsiteAddButton.tsx` (shows `useToast` + `touch()` after save).
8. **Strings** — every user-visible string goes through `useMessages()` (§7).
9. **Icons** — `import { Plus } from '@/components/icons'` (lucide). Umami-specific glyphs from
   `@/components/svg`.
10. **Nav entry** — add to `src/components/hooks/useWebsiteNavItems.tsx` (website sub-nav) or
    `src/app/(main)/SideNav.tsx` / `MobileNav.tsx`.
11. **Share support (optional)** — if the screen should work under `/share/<slug>`, register it in
    `PAGE_COMPONENTS` in `src/app/share/[slug]/[[...path]]/SharePage.tsx` and gate it on
    `parameters[pageKey] === true`.
12. **Test (optional but conventional)** — colocated `Name.test.tsx`, vitest + jsdom, using the
    custom `render` from `@/test/render` and `setTestUrl` from `@/test/navigation`.
    Copy: `src/components/common/Empty.test.tsx`. Run `pnpm test`.

---

## 10. Gotchas

- **`Button` uses `onPress`, not `onClick`** (react-aria under the hood). Same for
  `onOpenChange` on `Modal`/`DialogTrigger`.
- **Cache invalidation is `touch()`, not `invalidateQueries`.** Query keys embed
  `modified` from `useModified(key)`; call `touch('websites')` after a mutation.
  Only ~8 call sites use `queryClient.invalidateQueries` directly.
- **`useApi()` re-exports `useQuery`/`useMutation`** from react-query. Query hooks destructure
  them from `useApi()` rather than importing from `@tanstack/react-query`.
- **`app` store's `theme` field is dead.** `src/store/app.ts` seeds `theme` from
  `localStorage['umami.theme']` but nothing reads it. The live theme is zen's `useTheme()`,
  persisted under localStorage key `"theme"`. Always use `useTheme()`.
- **Name collisions with zen.** `Empty`, `Badge`, `Avatar`, `CopyButton`, `PageHeader`,
  `ComboBox` exist in *both* `@umami/react-zen` and `src/components/common`.
  The local ones are the project's (translated, opinionated) versions — check the import path
  before assuming behaviour. (`Link` is local-only: `src/components/common/Link.tsx`.)
- **`src/index.ts` is a package barrel, not an app barrel.** A few files import from it
  (`import { Favicon } from '@/index'` in `WebsitesDataTable.tsx`) — this is an anomaly;
  new code should import the concrete path (`@/components/common/Favicon`).
- **`src/components/hooks/`, not `src/hooks/`.** Always import through the
  `@/components/hooks` barrel (it carries the `'use client'` directive).
- **`LoadingPanel` returns the spinner whenever `isFetching` is true**, even with cached data —
  background refetches blank the panel. Pass `isFetching={false}` if you need sticky content.
- **`page.tsx` files are server components; the `*Page.tsx` sibling holds `'use client'`.**
  Don't add `'use client'` to `page.tsx` — it breaks the `metadata` export pattern.
- **Locale messages are fetched from `public/`, not bundled.** Only `en-US` is compiled in
  (`src/i18n/request.ts`, `useLocale.ts`). A missing `public/intl/messages/<locale>.json` at
  runtime silently degrades (`NextIntlClientProvider onError={() => null}`).
- **`next.config.ts` exposes env vars to the client camelCase** (`env:` block, line ~211):
  `apiUrl`, `basePath`, `cloudMode`, `cloudUrl`, `currentVersion`, `defaultCurrency`,
  `defaultLocale`, `selfTrack`, `selfRecord` — read as `process.env.basePath`, etc.
- **`next.config.ts` sets `typescript.ignoreBuildErrors: true`** — `pnpm build` will not catch
  type errors. Run `tsc`/`pnpm lint` yourself.
- **Biome disables `useExhaustiveDependencies`, `noExplicitAny`, and all a11y rules** — existing
  code relies on partial dependency arrays; don't "fix" them wholesale.
- `babel-plugin-react-compiler` is a devDependency; builds run with `--turbo`.
