# Workfront CORS Proxy

A Cloudflare Worker that lets the Workfront plugin call its configured Workfront tenant from the plugin's origin.

- Only forwards `/attask/api/vX.Y/...` paths to the fixed `WORKFRONT_ORIGIN`; it is not an open proxy.
- Only answers requests whose `Origin` is in `ALLOWED_ORIGINS` (exact match, or `*` for one hostname label).
- Allows `GET`, `POST`, `PUT` and preflight `OPTIONS` with the `Authorization` and `Content-Type` headers.
- Forwards only `Authorization`, `Content-Type` and `Accept`; no cookies or credentials are stored. Upstream redirects are rejected.

## Configure

Edit [wrangler.toml](./wrangler.toml):

- `WORKFRONT_ORIGIN`: the Workfront tenant.
- `ALLOWED_ORIGINS`: the origins that host the plugin (`workfront.html`).

## Run and Deploy

From this directory:

```sh
npx wrangler login
npx wrangler dev      # local at http://localhost:8787
npx wrangler deploy   # https://workfront-cors-proxy.<your-subdomain>.workers.dev
```

Then set `workfront.origin.proxy` in the DA Config default **data** sheet to the deployed Worker origin, alongside `workfront.origin`. The Worker's `WORKFRONT_ORIGIN` must match that tenant, and `ALLOWED_ORIGINS` must contain the deployed plugin origin. Links to Workfront records still use `workfront.origin`. Leave the proxy key blank or omit it to call Workfront directly; see the [configuration rules](../README.md#live-connection).

## Test

```sh
curl -i -X OPTIONS https://workfront-cors-proxy.<your-subdomain>.workers.dev/attask/api/v21.0/user/current \
  -H 'Origin: https://main--site--org.aem.page' \
  -H 'Access-Control-Request-Method: GET' \
  -H 'Access-Control-Request-Headers: authorization'
```
