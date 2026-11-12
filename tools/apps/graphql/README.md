# GraphQL Endpoints

Manage GraphQL endpoints for Structured Content. Authors create named
endpoints and pick which Structured Content schemas each one exposes. For
every endpoint, the app generates a GraphQL schema (SDL) from the picked JSON
Schemas and stores it in DA. The GraphQL engine that serves the delivery API
is built and hosted separately; it only reads what this app stores.

## Usage

Open the app in the da.live app shell:

```
https://da.live/app/adobe-rnd/aem-apps/tools/apps/graphql/graphql#/{org}/{site}
```

| URL hash | Opens |
| --- | --- |
| _(none)_ or `#/{org}` | The site dialog; cancelling shows a "No site selected" message |
| `#/{org}/{site}/endpoints` | Endpoint list |
| `#/{org}/{site}/endpoints/{endpoint}` | The `{endpoint}` screen |

`#/{org}/{site}` and unknown sections (`#/{org}/{site}/{other}`) are replaced
with `#/{org}/{site}/endpoints`. The `endpoints` segment leaves room for other
per-site sections later.

- The hash is the source of truth. Selecting an endpoint changes it, and
  back/forward moves between endpoints.
- An invalid endpoint name in the hash opens the list. An endpoint, or site
  schemas, that cannot be loaded shows an error toast and returns to the list.
- The list shows each endpoint's path (`/graphql/{name}`) and a copy button
  for its full URL, from the [`graphql.endpoint` config](#configuration).
- New endpoint (⊕) opens a dialog for the name, then an unsaved endpoint screen
  at `#/{org}/{site}/endpoints/{name}`. Cancel replaces the hash with
  `#/{org}/{site}/endpoints`, and so do saving and deleting an endpoint.
- Saving writes the config and a new SDL from the current schemas as one
  document, publishes it so the engine serves it, then returns to the list.
  Save is enabled only for a new endpoint or unsaved changes. If publishing
  fails, the document stays saved and the changes stay unsaved; save again to
  retry.
- Deleting unpublishes the endpoint, so the engine stops serving it, then
  removes its document. If unpublishing fails, the endpoint is kept; delete
  again to retry.
- The Schemas tab marks schemas that are added to the saved endpoint,
  invalid, not found, or being added or removed, and links to the schema
  editor. The search matches titles, IDs and these statuses; with several
  space-separated keywords, it lists schemas matching any of them.
- Users without write permission on the site see the app as view only.
- The app asks for confirmation before it discards unsaved changes, whether on
  a hash change or on page unload.

### Running in the app shell

The app is `graphql.html`, loaded in an iframe by the da.live app shell
(`nx/blocks/shell`).

- The shell passes the da.live URL's search and hash to the iframe once, on
  load. It doesn't sync them back: navigating inside the app does not change
  the da.live URL, and reloading da.live returns to the hash it was opened
  with.
- `graphql.html` only works inside the shell. Opened on its own (for example
  an endpoint link opened in a new tab), it stays blank, because the app waits
  for the shell's DA SDK handshake before it mounts.
- The adapters reach DA through the DA SDK's `actions.daFetch`, which adds
  the signed-in user's token and keeps it current as the shell refreshes it.
  `graphql.js` therefore awaits `DA_SDK` before mounting `graphql-app`.

### DA environment

The app uses the DA admin of the da.live page that opens it, which the
shell passes as `context.daOrigin` in the DA SDK: `admin.da.live`, unless
da.live is switched with its own `da-admin` parameter (for example
`?da-admin=stage`). Since the SDK's fetch sends the user's token to any URL,
an origin that isn't a known DA admin falls back to `admin.da.live`.

The AEM admin's ping (`admin.hlx.page/ping/{org}/{site}`) tells whether a
site runs on Helix 6:

| Site | Content | Preview and publish |
| --- | --- | --- |
| DA | DA admin `source` and `list` | `admin.hlx.page` |
| Helix 6 | AEM source bus, `api.aem.live/{org}/sites/{site}/source` | `api.aem.live` |

## Configuration

The `graphql.endpoint` key of the DA site config, else of the org config, is
the URL pattern of the GraphQL engine's endpoints. The app replaces
`${endpoint}`, `${org}` and `${site}`:

| key | value |
| --- | --- |
| `graphql.endpoint` | `https://content-ai-graphql-demo.corp.ethos09-prod-va7.ethos.adobe.net/graphql/${endpoint}?org=${org}&site=${site}` |

Without the key, copying gives only the engine path `/graphql/{name}`.

## Storage contract

All paths are relative to `/{org}/{site}`.

| Path | Content |
| --- | --- |
| `/.da/forms/schemas/{id}.html` | Source JSON Schemas (read only here) |
| `/.da/graphql/endpoints/{name}/endpoint.html` | Endpoint config and generated SDL |

Each endpoint has its own folder. Its `endpoint.html` uses the schema
editor's codeblock document with two code blocks: the config as JSON, then
the generated SDL as is, so the SDL needs no JSON escaping:

```html
<main><div>
<pre><code>{
  "name": "marketing",
  "schemas": ["article", "product"],
  "generatedAt": "2026-01-01T00:00:00.000Z"
}</code></pre>
<pre><code>type Article @contentType(id: "article") { … }
…</code></pre>
</div></main>
```

- Endpoint names are 3–32 characters matching `^[a-z][a-z0-9-]*$`
  (`validateEndpointName`) and cannot be changed after creation. Folders
  with other names, and other files in `endpoints/`, are not listed.
- `schemas` are schema ids, i.e. the file names without `.html`.
- The second code block is generated from `schemas` and is the SDL the engine
  serves; `generatedAt` is when it was generated. Both blocks are
  HTML-escaped (`&`, `<`, `>`) like any codeblock document.
- The engine reads the published document,
  `/.da/graphql/endpoints/{name}/endpoint`, from the site's delivery. Saving
  publishes it and deleting unpublishes it.
- Only core's `saveEndpoint` writes the document, so the config and its SDL
  are always saved in one write (see
  [core/README.md](core/README.md#operations)).
- The app reads only `name` and `schemas`; unknown keys are ignored.
- A newly selected schema is only included in the SDL after saving.
- The app does not detect when source schemas change after a save; saving the
  endpoint again refreshes the SDL
  (see [core/README.md](core/README.md#keeping-the-sdl-up-to-date)).

## SDL generation

`core/sdl.js` converts the JSON Schema subset that Structured Content
supports ([da-sc-sdk schema spec](https://github.com/adobe/da-sc-sdk/blob/main/docs/schema-spec.md))
into the SDL that Content AI registers, following "Step 2: writing the SDL"
of the [Content AI GraphQL user guide](https://wiki.corp.adobe.com/spaces/ContentAI/pages/4116182384/Draft+Content+AI+GraphQL+%E2%80%94+User+Guide).

```graphql
type Project @contentType(id: "project") {
  path: String!
  title: String
  data: ProjectData
}

type ProjectData { … }
```

- Each schema becomes one document type marked `@contentType(id: …)` with
  the schema id, and a `{Type}Data` type for its content. A schema whose root
  is an array gets `data: [{Type}Entry]` instead. Nested objects become
  `{Type}{Property}` types.
- The SDL declares only object types and scalars (`JSON`, `Date`, `Time`,
  `DateTime`, only those used). Content AI generates the queries
  (`{type}List` returning `{Type}Page`), `PageInfo`, filters and ordering,
  and provides the `@contentType` and `@source` directives, so the SDL
  declares none of them and has no field arguments. A key that isn't a valid
  field name is renamed, with `@source(key: …)` naming the original.
- The SDL has no descriptions: schema titles, descriptions and enum values
  are left out, and enum strings become `String`.
- Type names that GraphQL, the scalars or Content AI reserve (`Query`,
  `PageInfo`, `SortDirection`, the `*Condition` inputs) get a `Type` suffix.
  A nested type named like a generated type of another (`{Type}Page`,
  `{Type}Filter…`, `{Type}OrderBy…`) gets an `_` after the owner, as in
  `Product_Filter`, and other duplicates a number. Schemas whose type names
  clash that way can't share an endpoint.
- Content AI can't read schema ids or keys that are blank or contain a dot,
  so those schemas and properties are skipped with a warning.
- GraphQL `Int` is 32-bit, so an integer whose `minimum` or `maximum` lies
  outside that range becomes `Float`, with a warning.
- The generated SDL must fit Content AI's limits: 64 KiB, 1,000 indexed
  fields, counting scalar fields down to 10 levels below the document, and
  1,000 generated filter and sort types: a filter type for each object with
  indexed fields, and a sort type for each object with sortable ones (not
  Booleans, lists or keys with whitespace). Text sorts only if its index key
  enables filtering, which the app can't see, so it reports an error when the
  number and date fields alone exceed the limit, and a warning when text
  fields could.
- The SDL is built as a graphql-js syntax tree and printed with `print`, so
  escaping and formatting come from graphql-js. `printSchema` is not used
  because it drops applied directives.
- The document is checked with `buildASTSchema` and `validateSchema`, with
  the directives and a placeholder `Query` that Content AI provides; any
  failure or exceeded limit becomes a generation error, which blocks saving.
- Problems are reported per schema and JSON pointer.

## Core

`core/` holds the endpoint business logic. It has no app, DOM or DA imports
(enforced by ESLint) and reaches DA through a store it is given, so other code
can reuse it; the app's store and validator live in `adapters/`. See
[core/README.md](core/README.md).

## Architecture

A thin router entry lazily mounts one screen per route. The app has three
layers: `core/` holds the business logic, `adapters/` binds it to DA, and
`ui/` holds everything the browser renders. Each custom element in `ui/` has
its own folder named after its tag without the `gql-` prefix
(`ui/endpoint-list/` defines `gql-endpoint-list`), with code only it uses in
`helpers/`. `ui/shared/` holds generic components with no GraphQL knowledge,
and `ui/utils/` holds helper modules.

```
graphql.html                iframe page: import map, nx2 styles, DA SDK
graphql.js                  graphql-app: hash router, site loading, lazy screens, site picker
core/                       portable business logic, see core/README.md
  operations.js             createGraphqlCore: the workflows over a store
  sdl.js                    JSON Schema → SDL with graphql-js
  endpoint.js               endpoint config, SDL and URL formats, name rules
  schemas.js                schema documents, validity and readable issues
  codeblock.js              codeblock document format
adapters/                   the app's core instance and DA config
  index.js                  core and config bound to the DA SDK
  da-api.js                 SDK fetch, DA admin, Helix 6 detection, API URLs
  da-source.js              store port over DA and the AEM source bus
  da-config.js              `graphql.endpoint` URL pattern from the DA config
  sc-validator.js           da-sc-sdk validator, lazy
ui/                         custom elements, UI helpers and icons
  endpoints-screen/         endpoint list, new endpoint dialog, delete, read-only notice
  endpoint-screen/          one endpoint: load, save, discard, leave confirmation
    helpers/draft.js        schema selection, dirty check, save state
  header/                   site context, GraphQL › endpoints › name trail, screen actions slot
  endpoint-list/            table, endpoint URLs, row actions
  endpoint-editor/          alerts, Schemas and GraphQL SDL tabs
  schemas-panel/            Schemas tab: search and selection table
    helpers/options.js      schema rows: filter, sort, schema status
  sdl-panel/                GraphQL SDL tab: problems slot + lazy read-only CodeMirror
  shared/                   generic components with no GraphQL knowledge
    table/                  list-table styles, sort headers, empty rows, row-click delegation
    site-picker/            choose / change the org and site
    confirm/                promise-based confirmation dialog
    inline-alert/ status-light/ message/
  utils/
    route.js                hash ⇄ route, schema editor link
    messages.js             user-facing wording: status labels, toasts
    icons.js                S2 icons from ui/img/ as <svg><use>
  img/                      S2 icons
```

- Buttons, icon buttons and the loading spinner use nx2's `buttons.css`;
  toasts and dialogs use nx2's `toast` and `nx-dialog`; form fields use
  nx2's `form.css`.
- The site picker, `gql-confirm`, `nx-dialog` and
  `gql-sdl-panel` are imported when first needed.
- Only the endpoint screen imports `core/sdl.js`, dynamically and in parallel
  with the endpoint and schema requests, and `core/operations.js` imports it
  only when generating, so the list screen never loads graphql-js. No other
  module may import `sdl.js` statically.
- `adapters/` is the only code that talks to DA; screens use its `core`. The
  site root listing's `permissions` decide view only.
- The endpoint screen previews the SDL with `buildSdl` and blocks saving on
  generation errors; `saveEndpoint` applies the same rule.
- The entry turns the hash into a route, loads the site once from folder
  listings and the DA config (`{ org, site, endpoints, found, canWrite,
  endpointPattern }`, or `{ error }`) and
  passes it to the screen for the route. Before leaving a screen with unsaved
  changes it asks `gql-endpoint-screen.confirmLeave()`.
- Schema documents are read and validated only by the endpoint screen.
- Screens emit `route-change` (`{ route, replace, isNew }`) and
  `endpoints-change` (`{ endpoints }`); `gql-header` emits `endpoint-add` and
  `change-site`. Components below the screens never call the store.
  `change-site` and `schemas-select` bubble and are composed, so they reach
  the shell and the endpoint screen without being re-dispatched; other events
  don't bubble.

## Dependencies

| Dependency | Source |
| --- | --- |
| Lit | `tools/deps/lit` via the `da-lit` import map entry |
| graphql-js | `tools/deps/graphql`, vendored (about 31 KB gzipped) |
| DA SDK, `actions.daFetch` | `https://da.live/nx/utils/` |
| `hashChange`, `loadStyle`, styles, toast, dialog, `sl` components | `https://da.live/nx2/` |
| da-sc-sdk validator, CodeMirror | `https://da.live/nx/deps/` |

The nx2 modules are not part of nx2's public SDK, so changes in da-nx can
break the app.

To update graphql-js, install the new `graphql` version and rebuild the
bundle:

```sh
npx esbuild --format=esm --minify --bundle tools/deps/graphql/src/index.js \
  --outfile=tools/deps/graphql/dist/index.js
```

## Local development

Run `aem up` and open the app with `ref=local`:

```
https://da.live/app/adobe-rnd/aem-apps/tools/apps/graphql/graphql?ref=local#/{org}/{site}
```

## Tests

```sh
node --test "test/tools/apps/graphql/**/*.test.js"
```

`test/tools/apps/graphql/core/` covers the core: the converter, naming,
endpoint formats, schema issues, the codeblock format and the operations
against an in-memory store (`core/helpers/memory-store.js`).
`schema-spec.test.js` checks the SDL for every construct of the
[schema spec](https://github.com/adobe/da-sc-sdk/blob/main/docs/schema-spec.md).
The golden SDL fixtures live in `core/fixtures/`. `ui/` covers routes,
messages, the draft and the schema options. `adapters/` covers the DA and
Helix 6 requests against a fake DA SDK (`adapters/helpers/fake-sdk.js`).
