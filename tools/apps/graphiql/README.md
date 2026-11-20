# GraphiQL

Run GraphQL queries against the Content AI endpoints of a DA site, in da.live.

Open it at `https://da.live/app/adobe-rnd/aem-apps/tools/apps/graphiql/graphiql#/{org}/{site}/{endpoint}`.
Without an endpoint, the first endpoint of the site opens; without a site, a site picker opens.

## What it does

- Lists the endpoints that the GraphQL Endpoints app (`tools/apps/graphql`) stores, one folder per
  endpoint in `/{org}/{site}/.da/graphql/endpoints/{name}/`. It reads them from DA, or from the
  source bus for Helix 6 sites. The toolbar selects the endpoint.
- Renders [GraphiQL](https://github.com/graphql/graphiql) 3 for the selected endpoint. GraphiQL,
  React 18 and graphql-js load from unpkg and esm.sh; GraphiQL 3 is the last release with a UMD
  build.
- Gets the schema Content AI serves for the endpoint by introspection, through the same URL as the
  queries, so GraphiQL shows the real `Query`, filter and `orderBy` types. If introspection fails
  (site not served by the worker, endpoint missing, worker unreachable), the app shows the error
  instead of GraphiQL; it never builds the schema from the saved SDL.
- Starts with a query on the first `{type}List` query. GraphiQL keeps the tabs and history of each
  endpoint apart in the browser's local storage.
- GraphiQL is rendered in the light DOM, slotted into the app, so that its global styles and
  popups apply.

## Endpoint URL

Content AI cannot be called from a browser: its CORS preflight carries no API key and is rejected.
The app queries the query proxy of the `da-sc-graphql` worker instead, which answers the preflight
and adds the API key:

```text
https://da-sc-graphql.adobeaem.workers.dev/${org}/${site}/endpoints/${endpoint}/graphql
```

`${org}`, `${site}`, and `${endpoint}` are replaced. No API key is needed in the browser. A site or
org config can override the URL with `graphql.endpoint`. The worker only serves the sites it is
configured for.

## Structure

- `graphiql.js`: the `gqi-app` element; routes the hash, loads the site, selects the endpoint.
- `adapters/da.js`: reads the endpoint folders over the DA SDK.
- `core/client.js`: the endpoint URL and the introspection.
- `core/query.js`: the starter query.
- `ui/graphiql`: the `gqi-graphiql` element that loads and renders GraphiQL.
- `ui/shared`: the message and site-picker, copied from the GraphQL Endpoints app.

Tests are in `test/tools/apps/graphiql`.
