# Workfront Adobe I/O Runtime Proxy

An [Adobe App Builder](https://developer.adobe.com/app-builder/docs/intro_and_overview/) web action that lets the Workfront plugin call its Workfront tenant from the plugin's origin. It is an alternative to the [Cloudflare Worker](../cors/README.md) and enforces the same rules:

- Only forwards `/attask/api/vX.Y/...` paths to the fixed `WORKFRONT_ORIGIN`; it is not an open proxy. Paths are normalized before the check, so `..` segments cannot leave the API.
- Only answers requests whose `Origin` is in `ALLOWED_ORIGINS` (exact match, or `*` for one hostname label).
- Allows `GET`, `POST`, `PUT` and preflight `OPTIONS` with the `Authorization` and `Content-Type` headers.
- Accepts only form-encoded or JSON request bodies (other types get `415`).
- Requires a bearer token, and forwards only `Authorization`, `Content-Type` and `Accept`. Nothing is stored or logged. Upstream redirects are rejected.

The plugin sends the author's Experience Workspace IMS token. The action passes it through unchanged, so Workfront authenticates the author and applies their own permissions. No Workfront API key or other secret is deployed.

## What you need

| Requirement | How to check |
| --- | --- |
| An Adobe organization entitled to **App Builder** | In the [Adobe Developer Console](https://developer.adobe.com/console), select the organization and choose **Create project from template**. **App Builder** must be listed; otherwise ask your admin or [request a trial](https://developer.adobe.com/app-builder/trial/). |
| Developer access to that organization | Needed to create the project and deploy to its workspaces |
| Node.js 22 or later and the [Adobe I/O CLI](https://developer.adobe.com/app-builder/docs/guides/runtime_guides/tools/cli-install) | `node -v`, then `npm install -g @adobe/aio-cli` and `aio --version` |
| A Workfront tenant that accepts the Experience Workspace IMS token | The same requirement as direct mode and the Cloudflare Worker |

## Deploy

1. In the [Developer Console](https://developer.adobe.com/console), choose **Create project from template** → **App Builder**, and save it. This creates the **Stage** and **Production** workspaces, each with its own Runtime namespace.
2. Open the **Stage** workspace and choose **Download all**. The JSON file contains workspace credentials: keep it outside the repository and delete it after the next step.
3. From this directory, sign in and link the workspace:

   ```sh
   aio login
   aio app use ~/Downloads/<org>-<project>-Stage.json
   ```

   `aio app use` writes `.env` and `.aio`. Both are git-ignored and must never be committed.
4. Append the settings from [.env.example](./.env.example) to `.env`:

   | Setting | Meaning |
   | --- | --- |
   | `WORKFRONT_ORIGIN` | The Workfront tenant, e.g. `https://your-tenant.my.workfront.com`. It must match `workfront.origin` in the DA configuration. |
   | `ALLOWED_ORIGINS` | Comma-separated origins that host `workfront.html`, e.g. `https://main--aem-apps--adobe-rnd.aem.live`. |

5. Deploy and print the action URL:

   ```sh
   aio app deploy
   aio app get-url
   ```

   The URL looks like `https://<namespace>.adobeioruntime.net/api/v1/web/workfront/proxy`.

For **Production**, download the Production workspace file, run `aio app use` with it, add the settings to `.env` again, and deploy. Production gets its own URL. Change `.env` and run `aio app deploy` again to update the settings.

## Configure the plugin

In the DA configuration **data** sheet, set `workfront.origin.proxy` to the full action URL, including its path. Keep `workfront.origin` set to the tenant; links to Workfront records still use it. See the [plugin README](../README.md#add-to-experience-workspace).

## Test

```sh
PROXY=https://<namespace>.adobeioruntime.net/api/v1/web/workfront/proxy

# Preflight: expect 204 and access-control-allow-origin for the plugin origin
curl -i -X OPTIONS "$PROXY/attask/api/v21.0/user/current" \
  -H 'Origin: https://main--aem-apps--adobe-rnd.aem.live' \
  -H 'Access-Control-Request-Method: GET' \
  -H 'Access-Control-Request-Headers: authorization'

# Without a token: expect 401 {"error":{"message":"A bearer token is required."}}
curl -i "$PROXY/attask/api/v21.0/user/current" -H 'Origin: https://main--aem-apps--adobe-rnd.aem.live'
```

Use `aio app logs` or `aio rt activation list` to inspect recent invocations, and `aio app undeploy` to remove the action.

## Design notes and limits

- **`require-adobe-auth` is off on purpose.** App Builder's validator only accepts tokens for the project's own organization and integrated APIs, and the Experience Workspace token is issued to a different client. It would also disable `final` and `web-custom-options`. Workfront validates the token instead.
- **`final: true`** stops query or body parameters from overriding `WORKFRONT_ORIGIN` or `ALLOWED_ORIGINS`.
- **`web-custom-options: true`** lets the action answer CORS preflights itself instead of Runtime's permissive defaults.
- **`raw-http: true`** passes the request path, query and body through unparsed.
- [Runtime limits](https://developer.adobe.com/app-builder/docs/guides/runtime_guides/system-settings) apply: request and response payloads of 1 MB each, a 60-second limit for web actions, and per-namespace rate and concurrency limits. Occasional cold starts add latency.
- Web actions are public. Anyone who knows the URL can call it, but only with a valid Workfront-accepted token and only for the configured tenant's API. See [Securing Web Actions](https://developer.adobe.com/app-builder/docs/guides/runtime_guides/securing-web-actions).
