# Localization core

Shared core for Localization V2: translation, regional copies, and content shared within or across sites. It replaces the loc app (da-nx `nx/blocks/loc`) and MSM (`tools/apps/msm`, `tools/plugins/msm`).

Status: draft. The domain layer is built; providers and the service layer are in design.

## Layers

```
core/
  index.js       public API (createLocalization + constants). The only import for app/plugin. (planned)
  service.js     composes domain + providers; caches; refresh()          (planned)
  domain/        pure logic, no I/O
  providers/     I/O implementations built from { fetch, daOrigin }     (planned)
```

- UI layers import only `index.js`.
- `domain/` never does I/O.
- Providers are the only code that touches da-admin, nx, connectors, or the network.
- `fetch` is supplied by the caller. The core never discovers IMS, following the `nx/public/loc` pattern (da-nx PR 801).

## Model

- **Location**: site + folder + language. Id: `site:/path`; `/` means the whole site.
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
- Values are trimmed and lowercased.
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

`pageStatus(chain)` → `{ relationship, sync, effectiveSource, reasons }`

- **relationship**: root · linked · local copy · translation · standalone · not created · unavailable · config error · unknown
- **sync**, in urgency order: needs review · blocked by source review · source deleted · ready to save · translating · behind source · current
- **Effective source**: the nearest existing page above, passing only through missing pages in `linked` locations.
- **No index entry:**
  - the source exists → local copy, behind source (`base-unknown`)
  - no source → standalone
- **Behind source**: the recorded base (source page ID + version) ≠ the effective source.

Per-page facts come from providers:

| Fact | Source |
|---|---|
| exists, id, version | da-admin |
| base | `/.da/loc` index |
| needsReview | in-doc metadata (fetched lazily) |
| job | translation jobs |

## Actions

`availableActions({ status, location, translationSupported })` → `[{ action, enabled, reasons, creates?, options?, default?, destructive? }]`

| Action | Applies to | Gate |
|---|---|---|
| rollout, translate | local copy, translation, linked, not created | the location's `actions` |
| reconnect | local copy, translation | `link` and `missingPages: linked`; destructive |
| save | any page with `ready to save` | — |

- There's no detach action: rollout or translate on a linked page has `creates: true`, and the UI can call it "Detach".
- Rollout and translate don't publish unless `onComplete` says so.

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

- Provider contracts and naming.
- Legacy config readers (`translate.json`, the org `msm` sheet).
- Translation jobs and the connector interface (`supports()`, language-code mapping).
- Rename, delete and re-parent behavior; path collisions with standalone pages.
- Internal link and fragment rewriting; sheets and media.
- An admin UI for defining relationships across sites.
