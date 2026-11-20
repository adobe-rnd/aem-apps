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
- Gets the schema Content AI serves for the endpoint by introspection, with the same URL and API
  key as the queries, so GraphiQL shows the real `Query`, filter and `orderBy` types. It
  introspects again when the API key changes. If introspection fails (no or wrong API key, CORS),
  the app shows the error instead of GraphiQL; it never builds the schema from the saved SDL.
- Starts with a query on the first `{type}List` query. GraphiQL keeps the tabs and history of each
  endpoint apart in the browser's local storage.
- GraphiQL is rendered in the light DOM, slotted into the app, so that its global styles and
  popups apply.

## Endpoint URL

The app queries the Content AI GraphQL endpoint directly:

```text
https://publish-p153659-e1614585.adobeaemcloud.com/adobe/experimental/aemcontentai-expires-20261231/contentAI/graphql/${org}--${site}/endpoints/${endpoint}/graphql
```

`${org}`, `${site}`, and `${endpoint}` are replaced. Content AI needs an API key: enter it in the toolbar's
**API key** field. It is sent as `x-api-key` and kept in the browser's local storage.

The browser can only call Content AI if it allows the da.live origin (CORS).

## Structure

- `graphiql.js`: the `gqi-app` element; routes the hash, loads the site, selects the endpoint.
- `adapters/da.js`: reads the endpoint folders over the DA SDK.
- `core/client.js`: the endpoint URL and the introspection.
- `core/query.js`: the starter query.
- `ui/graphiql`: the `gqi-graphiql` element that loads and renders GraphiQL.
- `ui/shared`: the message and site-picker, copied from the GraphQL Endpoints app.

Tests are in `test/tools/apps/graphiql`.
