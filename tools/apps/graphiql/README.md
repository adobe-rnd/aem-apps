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
- Builds the schema from the SDL saved in the endpoint's `endpoint.html` (its second code block),
  not by introspection. It adds what Content AI generates when serving it: the `@contentType` and
  `@source` directives, `PageInfo`, a `{Type}Page` and a `{type}List` query per document type.
  The generated filter and sort inputs are typed `JSON`, so any `filter` or `orderBy` object
  literal validates; Content AI checks them when the query runs.
- Starts with a query on the first document type. GraphiQL keeps the tabs and history of each
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
- `adapters/da.js`: reads the endpoint folders, `endpoint.html` and the config over the DA SDK.
- `core/client.js`: the endpoint URL.
- `core/sdl.js`: reads the SDL from `endpoint.html` and adds the generated queries.
- `ui/graphiql`: the `gqi-graphiql` element that loads and renders GraphiQL.
- `ui/shared`: the message and site-picker, copied from the GraphQL Endpoints app.

Tests are in `test/tools/apps/graphiql`.
