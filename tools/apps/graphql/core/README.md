# GraphQL core

The business logic of the [GraphQL endpoints app](../README.md): endpoint
rules, schema loading, SDL generation, and saving and deleting endpoints. It
has no app, DOM or DA imports, so other code can reuse it. For example, the
schema editor could save the affected endpoints after schemas change, and the
GraphQL engine or a script could do the same.

## Contents

| Module | Use it for | Needs |
| --- | --- | --- |
| `operations.js` | `createGraphqlCore`: list, load, save and delete endpoints | a store |
| `sdl.js` | `buildSdl`, `generateSdl`: JSON Schemas → SDL | graphql-js |
| `endpoint.js` | endpoint names and URLs, the endpoint document format | nothing |
| `schemas.js` | parsing schema documents, validity and readable issues | nothing |
| `codeblock.js` | reading and writing DA codeblock documents | nothing |

Everything except `createGraphqlCore` is a pure function. `sdl.js` imports
graphql-js from `tools/deps/graphql/`; `operations.js` loads it only when it
generates SDL.

## Quick start

```js
import { createGraphqlCore } from './core/operations.js';

const core = createGraphqlCore({ store, loadValidator });

// Create or replace the "shop" endpoint, its SDL built from both schemas:
const result = await core.saveEndpoint({
  org, site, config: { name: 'shop', schemas: ['product', 'category'] },
});
if (result.error) {
  console.warn(result.code, result.error);
} else {
  result.warnings.forEach(({ schemaId, message }) => console.warn(schemaId, message));
}
```

`createGraphqlCore({ store, loadValidator?, now? })` takes:

- `store`: how the core reads and writes DA content; see [Store](#store).
- `loadValidator`: resolves to `validate(schema)`, which returns
  `{ valid, schemaIssues }`, such as da-sc-sdk's `validateSchema`. Without
  one, every schema that parses as JSON is valid. If it fails to load,
  `loadSchemas` and `saveEndpoint` fail with `load-failed`.
- `now`: returns the `Date` written as `generatedAt`. It defaults to the
  current time; tests pass a fixed one.

The core keeps no state between calls: each call reads what it needs through
the store, so it always works on what is stored.

## Store

A store is the one thing a new caller has to write. It has four methods,
which take an absolute DA `path` such as `/{org}/{site}/.da/forms/schemas`:

| Method | Success |
| --- | --- |
| `list({ path })` | `{ items: [{ name, ext?, path }], permissions? }` |
| `read({ path })` | `{ text }` |
| `write({ path, text })` | `{ ok: true }` |
| `remove({ path })` | `{ ok: true }` |

- Methods resolve and never throw. A failure is `{ error, status }`, with the
  HTTP status when there is one.
- `list` returns every item, across all pages. `name` has no extension,
  folders have no `ext`, and `path` is what `read` accepts. A missing folder
  lists as empty or fails with `404`.
- `read` of a missing document fails with status `404`; that is how the core
  tells a missing endpoint from an unreadable one.
- `write` creates or replaces the HTML document. `remove` of a missing
  document may fail with `404`; the core ignores it.
- `permissions` are the actions allowed on the site folder, such as `read`
  and `write`. Without them the site counts as writable.

Existing stores:

| Store | Backed by | Runs in |
| --- | --- | --- |
| [`adapters/da-source.js`](../adapters/da-source.js) | nx2's `source` API, DA and hlx6 sites | a signed-in browser in the da.live shell |
| [`memory-store.js`](../../../../test/tools/apps/graphql/core/helpers/memory-store.js) | a `Map`, with injectable failures | tests |

For a script, a store over DA's admin API takes a few lines. This sketch
covers DA sites only; hlx6 sites use a different API.

```js
const ADMIN = 'https://admin.da.live';

export function createDaAdminStore({ token }) {
  const request = (url, { headers, ...opts } = {}) => fetch(url, {
    ...opts, headers: { ...headers, authorization: `Bearer ${token}` },
  }).catch(() => undefined);
  const failure = (resp) => ({ error: 'Request failed.', status: resp?.status });
  const done = (resp) => (resp?.ok ? { ok: true } : failure(resp));

  async function listAll({ path, continuationToken, items = [] }) {
    const headers = continuationToken ? { 'da-continuation-token': continuationToken } : {};
    const resp = await request(`${ADMIN}/list${path}`, { headers });
    const page = resp?.ok ? await resp.json().catch(() => undefined) : undefined;
    if (!Array.isArray(page)) return failure(resp);
    const next = resp.headers.get('da-continuation-token');
    const all = [...items, ...page];
    return next ? listAll({ path, continuationToken: next, items: all }) : { items: all };
  }

  async function read({ path }) {
    const resp = await request(`${ADMIN}/source${path}`);
    const text = resp?.ok ? await resp.text().catch(() => undefined) : undefined;
    return text === undefined ? failure(resp) : { text };
  }

  function write({ path, text }) {
    const body = new FormData();
    body.append('data', new Blob([text], { type: 'text/html' }));
    return request(`${ADMIN}/source${path}`, { method: 'POST', body }).then(done);
  }

  const remove = ({ path }) => request(`${ADMIN}/source${path}`, { method: 'DELETE' }).then(done);

  const list = ({ path }) => listAll({ path });

  return { list, read, write, remove };
}
```

## Operations

| Operation | Result |
| --- | --- |
| `listEndpoints({ org, site })` | `{ endpoints, found, canWrite }` |
| `loadSchemas({ org, site })` | `{ schemas: [{ id, status, schema?, valid, issues }] }` |
| `loadEndpoint({ org, site, name })` | `{ config }` |
| `saveEndpoint({ org, site, config })` | `{ config, sdl, warnings }` |
| `deleteEndpoint({ org, site, name })` | `{ ok: true }` |

- The verb says what reaches the store: `save*` and `delete*` write, while
  `list*` and `load*` only read. No operation changes something in
  memory only; for an SDL that isn't saved, call `buildSdl` from `sdl.js`.
- Failures return `{ code, error, status? }`; see [Failures](#failures).
- `listEndpoints` returns the sorted endpoint names. `found` is false for a
  site with no content, since DA lists a missing site as empty; `canWrite`
  comes from the store's `permissions`.
- `saveEndpoint` is the only writer, so an endpoint's config and SDL always
  match. It creates or replaces the endpoint: it validates the config,
  generates the SDL, then writes both as one document. Nothing is written
  if generation fails. To avoid replacing an endpoint, check `listEndpoints`
  first.
- `deleteEndpoint` removes the endpoint document; a missing one counts as
  deleted.
- A missing endpoints or schemas folder counts as empty; any other listing
  failure returns `load-failed`.

The documents the core reads and writes are described in the app's
[storage contract](../README.md#storage-contract).

## Failures

`code` is stable, so callers can branch on it. `error` is a user-facing
English sentence that callers can show, but its wording may change. `status`
is the store's HTTP status, when there is one.

| `code` | Meaning |
| --- | --- |
| `not-found` | The endpoint doesn't exist (`status` 404). |
| `invalid-config` | The config's name or schema selection is invalid, or the stored config isn't valid JSON. |
| `generation-failed` | The SDL couldn't be generated; nothing was written. |
| `load-failed` | The store couldn't list or read a document. |
| `save-failed` | The store couldn't write a document. |
| `delete-failed` | The store couldn't remove a document. |

`generation-failed` adds `errors` and `warnings`, each
`{ schemaId, pointer, message }`.

## Keeping the SDL up to date

An endpoint's SDL is generated from all of its `config.schemas` at once,
and changes only when the endpoint is saved:

| When | Call |
| --- | --- |
| An endpoint's schema selection changed | `saveEndpoint({ org, site, config })` |
| Schemas were created, changed or deleted | `loadEndpoint`, then `saveEndpoint` with its `config`, for each endpoint that selects one of them |
| An endpoint needs a fresh SDL, e.g. after a core update | `loadEndpoint`, then `saveEndpoint` with its `config` |

For example, after the `product` schema changed:

```js
const { endpoints } = await core.listEndpoints({ org, site });
const loaded = await Promise.all(endpoints.map((name) => core.loadEndpoint({ org, site, name })));
const affected = loaded.filter(({ config }) => config?.schemas.includes('product'));
const results = await Promise.all(affected.map(({ config }) => core.saveEndpoint({ org, site, config })));
```

- Missing (deleted) or invalid schemas are skipped with a warning; the other
  selected schemas still generate. They stay in the config until the
  endpoint is saved without them, so a restored schema is picked up again.
- The stored endpoint is kept, and `saveEndpoint` fails, when a selected
  schema can't be read, no selected schema is usable, or the SDL is invalid,
  for example because two schemas produce the same type.
- Each `saveEndpoint` loads the site's schemas, so the SDL is built from what
  is stored at that moment.
- A new schema affects an endpoint only after the endpoint selects it.

## Importing the core

Where the importing code runs decides how it can reach the core:

- **This repository**: import by path, as `adapters/index.js` does. Pages on
  aem.live load it from the same origin.
- **Node**: import from a checkout, as the tests do. Node 18+ has the `fetch`,
  `FormData` and `Blob` the store sketch uses.
- **Other origins**, such as da-nx's schema editor on da.live: not yet.
  aem.live sends no CORS headers for this repository, so a cross-origin
  `import()` fails. This needs CORS headers for `/tools/apps/graphql/core/`
  and `/tools/deps/graphql/`, or a shared home for the core.

A copy must keep `core/` and `tools/deps/graphql/` at the same relative
positions, because `sdl.js` imports `../../../deps/graphql/dist/index.js`.

## Changing the core

- Import only core modules and `tools/deps/graphql/`, and use no browser- or
  Node-only APIs. ESLint enforces this for `core/**/*.js`.
- Report expected failures as `{ code, error, status? }` instead of throwing,
  reusing a [code](#failures) when one fits.
- Take one destructured object argument, so arguments can be added later.
- Other code relies on the operation names, arguments, results and failure
  codes; add to them rather than changing them.
- Cover changes in `test/tools/apps/graphql/core/` with the memory store.

## Limitations

- `unwrapCodeblock` uses regular expressions rather than a DOM. It decodes
  numeric entities and `&amp;`, `&lt;`, `&gt;`, `&quot;`, `&apos;` and
  `&nbsp;` only.
- nx2's `source.list` doesn't return the status of a failed listing, so
  `adapters/da-source.js` reports it as `404`, and the app shows a folder it
  can't list as empty.
- There is no locking: when two callers save the same endpoint, the last
  write wins.
- Schema renames aren't tracked. Endpoints keep the old id and skip it as
  missing until they are saved with the new one.
