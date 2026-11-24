# GraphiQL

Run GraphQL queries against the GraphQL endpoints of a DA site, in da.live.

Open it at `https://da.live/app/adobe-rnd/aem-apps/tools/apps/graphiql/graphiql#/{org}/{site}/{endpoint}`.
Without an endpoint, the first endpoint of the site opens; without a site, a site picker opens.

## What it does

- Lists the endpoints that the GraphQL Endpoints app (`tools/apps/graphql`) stores, one folder per
  endpoint in `/{org}/{site}/.da/graphql/endpoints/{name}/`. It reads them from DA, or from the
  source bus for Helix 6 sites.
- Shows a da.live canvas, like the GraphQL Endpoints app: a bar with the trail
  `GraphQL › endpoints › {endpoint}` and, at its end, a gear that opens the site picker. The endpoint
  crumb is a menu that switches to another endpoint of the site.
- Renders [GraphiQL](https://github.com/graphql/graphiql) 3 for the selected endpoint. GraphiQL,
  React 18 and graphql-js load from unpkg and esm.sh; GraphiQL 3 is the last release with a UMD
  build.
- Gets the schema the GraphQL service serves for the endpoint by introspection, through the same URL as the
  queries, so GraphiQL shows the real `Query`, filter and `orderBy` types. If introspection fails
  (site not served by the worker, endpoint missing, worker unreachable), the app shows the error
  instead of GraphiQL; it never builds the schema from the saved SDL.
- Starts with a query on the first `{type}List` query. GraphiQL keeps the tabs and history of each
  endpoint apart in the browser's local storage.
- GraphiQL is rendered in the light DOM, slotted into the app, so that its global styles and
  popups apply.

## Endpoint URL

The GraphQL service cannot be called from a browser: its CORS preflight carries no API key and is rejected.
The app queries the `da-sc-graphql` worker instead, which answers the preflight and adds the API
key. The worker's base URL is the `sc.graphql.url` key of the DA site config, else of the org
config (https only), the same key the GraphQL Endpoints app sends its reindex calls to:

| key | value |
| --- | --- |
| `sc.graphql.url` | `https://graphql-worker.example.com` |

The app queries `{sc.graphql.url}/{org}/{site}/endpoints/{endpoint}/graphql`. No API key is needed
in the browser. Without the key, the app shows an error instead of GraphiQL. The worker only serves
the sites it is configured for.

## Structure

- `graphiql.js`: the `gqi-app` element; routes the hash, loads the site, selects the endpoint.
- `ui/header`: the bar; `ui/endpoint-menu`: the `gqi-endpoint-menu` endpoint switcher.
- `adapters/da.js`: reads the endpoint folders and `sc.graphql.url` over the DA SDK.
- `core/client.js`: the endpoint URL and the introspection.
- `core/query.js`: the starter query.
- `ui/graphiql`: the `gqi-graphiql` element that loads and renders GraphiQL.
- `ui/shared`: the canvas, message and site-picker, copied from the GraphQL Endpoints app.

Tests are in `test/tools/apps/graphiql`.
