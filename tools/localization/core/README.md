# Localization core

Shared core for Localization V2: translation, regional copies, and content shared within or across sites. It replaces the loc app (da-nx `nx/blocks/loc`) and MSM (`tools/apps/msm`, `tools/plugins/msm`).

Status: draft. The domain layer and the facade's `page()` are built; providers and services are in design.

## Layers

```
core/
  index.js          public API: createLocalization + constants. The only import for app/plugin.
  localization.js   facade: composes domain + providers + services; caches; refresh()
  domain/           pure logic, no I/O
  api/              backend transport: DA + AEM admin; legacy adapter now, nx api.js later
  providers/        supply data: config, page-info, loc-index
  services/         perform operations: content, translation-connectors, publish             (planned)
```

- UI layers import only `index.js`.
- `domain/` never does I/O.
- Providers and services are the only code that touches da-admin, nx, connectors, or the network.
- `fetch` is supplied by the caller. The core never discovers IMS, following the `nx/public/loc` pattern (da-nx PR 801).

## Backend api

Providers and services never build URLs. They call an injected `api` that mirrors the surface of nx2's `api.js`, so the core works on both backends:

| | Legacy | Helix 6 |
|---|---|---|
| source, list, config | `admin.da.live` | `api.aem.live/{org}/sites/{site}/...` |
| preview, live | `admin.hlx.page/{preview\|live}/{org}/{site}/main{path}` | `api.aem.live/{org}/sites/{site}/{preview\|live}{path}` |

```js
api.isHlx6({ org, site })
api.source.get / getMetadata / delete({ org, site, path })
api.source.save({ org, site, path, body, headers })            // headers: If-Match / If-None-Match
api.source.list({ org, site?, path?, continuationToken? })     // → { ok, status, items, continuationToken }
api.config.get({ org, site })
api.aem.preview / publish({ org, site, path })                 // AEM path (no .html)
```

- **Default today:** `api/legacy.js`, built from `actions.daFetch`. It's legacy only and reports `isHlx6 → false`.
- **Later:** once da-nx makes `api.js` public, that becomes the default. Callers can pass it as `api` before then.

## Providers and services (draft contracts)

```js
createLocalization({
  org,
  actions,                                               // DA SDK actions; actions.daFetch builds the default providers
  daOrigin,                                              // default https://admin.da.live
  providers: { config, pageInfo, index },                // optional overrides
  services: { copy, translationConnectors, publish },    // optional
})
```

Default providers are built from `actions.daFetch` and `daOrigin`. Any of them can be overridden, e.g. with fakes in tests. Without `actions.daFetch`, all three providers must be passed. No default services exist yet; `copy` will come from `actions.loc` (PR 801) when `execute()` is designed.

**Providers** supply data. The `index` provider also persists its own data.

| Key | File | Methods |
|---|---|---|
| config | `providers/config.js` | `listSites() → [site]` (`GET /list/{org}`, paginated)<br>`read(site) → rows \| null`: the `locations` sheet of `GET /config/{org}/{site}`; `[]` when there's no config or no sheet; `null` on 401/403 (unreadable) |
| pageInfo | `providers/page-info.js` | `get(site, path) → { exists, id, version }`: `HEAD /source/...`; `id` = `X-da-id`, `version` = `ETag` (changes on every save, including saves that don't create a version)<br>`needsReview(site, path) → bool`: fetches the content, parses it (`DOMParser`; `parseHtml` can be injected) and looks for `da-diff-*` / legacy `da-loc-*` elements or `da-diff-*` attributes<br>`list(site, folder) → [{ path, isFolder, lastModified? }]` (`GET /list/...`, paginated; no id/version) |
| index | `providers/loc-index.js` | File: `/{site}/.da/loc{location path}/index.json` in the location's site (whole site: `/.da/loc/index.json`).<br>`read(locationId) → { pages: { [pageId]: { base, job, overrides } }, pending: { [path]: { job } } }` (`pending` covers pages that don't exist yet, e.g. a first translation). 404 → empty; other failures throw.<br>`write(locationId, changes) → index`: `changes` has the same shape, and a `null` entry deletes it. Read-modify-write guarded by `If-Match` (or `If-None-Match: *` when creating), retried on 412 up to `maxAttempts` (3). |

**Services** perform operations.

| Key | File | Methods |
|---|---|---|
| copy | `services/copy.js` | `merge({ source, target, labels })`, `overwrite({ source, target })` (nx `createCopy`) |
| translationConnectors | `services/translation-connectors.js` | `supports(srcLang, tgtLang)`, `send(job)`, `status(job)`, `save(job)`, `cancel(job)` |
| publish | `services/publish.js` | `preview(paths)`, `publish(paths)` |

## Model

- **Location**: site + folder + language. Id: `site:/path`; `/` means the whole site.
- **Page paths** are full DA paths within a site, including the extension (`/en/products/x.html`, `/en/data.json`).
- **Relationship**: a location's link to its one source location. Locations form a forest, max depth 5 (including the root).
- **Page**: belongs to its deepest containing location. Dot-folders (`.da`, `.trash`, …) belong to no location.
- **Source page**: same relative path in the source location. If that path belongs to a nested location inside the source, the page has no source page.

```
global:/en          en-US   (root)
├── global:/uk      en-GB
├── global:/emea/en en
│   └── global:/emea/es  es-ES
│       └── brand-b:/es  es-ES
└── brand-b:/       en-US
```

## Config

Each site has a `locations` sheet in its own config. **The target defines the relationship**: a location's row names its source, and the source's site never lists its targets.

| Column | Values | Default (rows with a source) |
|---|---|---|
| path | `/folder`, `/` | `/` |
| language | BCP 47 (`en`, `en-US`, `es-419`) | required |
| label | text | generated, e.g. "Mexican Spanish" |
| source | `site:/path`, or `/path` for the same site; empty for a root | — |
| actions | `link`, `rollout`, `translate` | `rollout` |
| missingPages | `linked` · `none` | `none` |
| conflictBehavior | `merge`, `overwrite`; first is the default | `merge` |
| onComplete | `none` · `preview` · `publish` | `none` |

- Headers are matched case-insensitively, ignoring spaces, `-` and `_`.
- Values are trimmed. Site names and the values of `actions`, `missingPages`, `conflictBehavior` and `onComplete` are lowercased; languages are canonicalized (`en-us` → `en-US`); paths and labels keep their case.
- A root row must leave the relationship columns empty.
- Translation service, env, DNT rules and per-target connector options stay in `translate.json`.

Validation produces issues as data (`{ level, code, site, row, id, field, message }`). A location with an error stays in the model with `valid: false`.

| Code | Level |
|---|---|
| invalid-site, invalid-path | error (row dropped) |
| invalid-language, invalid-source, invalid-actions, invalid-missing-pages, invalid-conflict-behavior, invalid-on-complete, root-has-relationship-settings, duplicate-location | error |
| unknown-source (source's site loaded, location missing), cycle, max-depth, translate-same-language | error |
| invalid-ancestor (names the root-cause ancestor) | error |
| cross-language (link/rollout across base languages without translate) | warning |
| source-unresolved (source's site not loaded or unreadable), ancestor-unresolved | warning; location `resolved: false` |

## Page state

`pageStatus(chain)`, where `chain` is `[{ ref, info }]` from `sourceChain`, → `{ relationship, sync, effectiveSource, reasons }`, or `null` when there's no page: an empty chain (no location), a missing root page, or a missing page with no content above it.

- **relationship**: root · linked · local copy · translation · standalone · not created · unavailable · config error · unknown
- **sync**, in urgency order: needs review · blocked by source review · source deleted · ready to save · translating · behind source · current
- **Effective source**: the nearest existing page above, passing only through missing pages in `linked` locations.
- **No index entry:**
  - the source exists → local copy, behind source (`base-unknown`)
  - no source → standalone
- **Behind source**: the recorded base (source page ID + version) ≠ the effective source.

Per-page info comes from providers:

| Info | Provider |
|---|---|
| exists, id, version | pageInfo (da-admin) |
| base, job | index (`/.da/loc`) |
| needsReview | pageInfo.needsReview (in-doc metadata, fetched lazily) |

## Actions

`availableActions({ status, location, translationSupported })` → `[{ action, enabled, reasons, creates?, options?, default?, destructive? }]`

| Action | Applies to | Gate |
|---|---|---|
| rollout, translate | local copy, translation, linked, not created | the location's `actions` |
| reconnect | local copy, translation | `link` and `missingPages: linked`; destructive |
| save | any page with `ready to save` | — |

- There's no detach action: rollout or translate on a linked page has `creates: true`, and the UI can call it "Detach".
- Rollout and translate don't publish unless `onComplete` says so.

## Facade API

```js
import { createLocalization } from './core/index.js';
const localization = createLocalization({ org, actions });
await localization.page(site, path) // { location, chain: [{ ref, info }], status, actions }
localization.refresh()              // clear all caches
```

`page()`:
- Loads the page's site config, then each source site up the location chain as it's discovered (following location sources, even past nested locations). It never scans the other sites.
- Reads page info and index entries for every page in the chain.
- Fetches `needsReview` only for the page itself (if it exists) and its effective source.
- Asks `translationConnectors.supports()` only when the location allows translate.
- Outside any location, it returns `{ location: null, chain: [], status: null, actions: [] }`.

Configs, page info, index reads and review flags are cached per instance until `refresh()`. Each call uses the caches current when it started, so reads still in flight during a `refresh()` never leak into later calls.

## Domain API (internal)

| Module | Exports |
|---|---|
| language | parseLanguage, isSameBaseLanguage, canTranslate, defaultRefreshAction, languageLabel |
| config | parseConfig, normalizePath, parseSource, constants |
| resolve | findLocation, sourcePage, sourceChain (includes self), targetPages, targetLocations (direct only), equivalentSites |
| status | pageStatus, SYNC_ORDER |
| actions | availableActions |

## Known limitations

- **Targets are only as complete as your access.** Relationships live in the target's site, so finding a location's targets means reading the config of every site you can access. Targets in sites you can't see are invisible; nothing indicates that they exist. Affected:
  - fan-out views
  - rollout to all targets
  - the impact of deleting, renaming or moving a source page

  A page's own status is unaffected, because it only looks upward.
- **Upward resolution needs read access to every site in the chain.** If a source's site config can't be read, the location is `unresolved` and its pages show `unknown`.
- **Paths are matched as-is.** Localized slugs (`/fr/produits` ← `/en/products`) aren't supported yet.
- **`needsReview` costs a content fetch per page**, so it's loaded lazily.
- **Max depth is 5.**

## Open

- Provider/service contract details: index file layout, page-info batching, connector job shape.
- Legacy config readers (`translate.json`, the org `msm` sheet).
- Translation jobs and the connector interface (`supports()`, language-code mapping).
- Rename, delete and re-parent behavior; path collisions with standalone pages.
- Internal link and fragment rewriting; sheets and media.
- An admin UI for defining relationships across sites.
