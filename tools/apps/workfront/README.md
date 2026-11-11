# Workfront in Experience Workspace

A Experience Workspace author plugin.

## Register In EW

Deploy this directory to an HTTPS static host. Add a **Workfront** entry in the site's **library** configuration, pointing to the deployed `tools/apps/workfront/index.html` URL. EW opens that URL in its editor side panel. Use the `local` ref for local development, as described in the [EW author-plugin guide](https://www.aem.live/docs/ew/developing/micro-frontends/2-build-your-basic-plugin). This plugin requires the EW iframe handshake and current page context; opening its URL standalone is unsupported.

The plugin connects through the official [EW/DA SDK](https://da.live/nx/utils/sdk.js):

- The host's `context.org`, `context.repo` and `context.path` identify the current page. Missing context is shown explicitly; no page is inferred from names or URLs.
- Copy to chat calls `actions.setPrompt(text, { autoSend: false })`, then opens the chat panel. It never calls `sendText` or modifies the page content.
- Page context is the SDK snapshot supplied when the plugin opens. Reopen the plugin after changing documents if the host does not reload it.

## Live Connection

Configure [config.js](./config.js) with the Workfront tenant origin and an API version supported by that tenant:

```js
export default Object.freeze({
  workfrontOrigin: 'https://your-tenant.my.workfront.com',
  apiVersion: 'v21.0',
});
```

The plugin calls Workfront directly at `https://your-tenant.my.workfront.com/attask/api/v21.0`. It reads the current IMS token from the EW SDK and sends it as an `Authorization: Bearer` header. The token stays in memory and is refreshed when EW posts an updated token; it is never written to config, storage or logs. This uses the signed-in author's Workfront permissions.

If Workfront does not allow CORS from the plugin origin, deploy the Cloudflare Worker in [cors/](./cors/README.md) and set `proxyOrigin` in `config.js` to its URL. API calls then go through the proxy; record links still use `workfrontOrigin`.

Without a proxy, Workfront must accept direct browser requests from the deployed plugin origin, including CORS preflights for the `Authorization` and `Content-Type` headers and `GET`, `POST` and `PUT` methods. The host-provided token must be valid for the configured Workfront tenant and authorized for its API. If Workfront rejects it with 401, verify the token's audience and tenant access; do not put a Workfront secret in this app or fall back to a shared account.

The client calls these native Workfront API resources:

| Route | Method | Response or behavior |
| --- | --- | --- |
| `/user/search?ID=$$USER.ID` | GET | Current signed-in Workfront user |
| `/project/search` | GET | Accessible projects |
| `/task/search` | GET | Accessible tasks |
| `/user/search` | GET | Accessible users, with `ID` and `name` |
| `/task/{id}` | GET | Fresh task, including its `URL` |
| `/task/{id}` | PUT | Update only `URL` |
| `/task` | POST | Create a task with `name`, `projectID`, `description` and `URL` |

Searches use the native `fields`, `$$LIMIT`, `$$FIRST` and `ID_Sort` parameters and paginate through all accessible results. `POST` and `PUT` use URL-encoded Workfront API parameters. Workfront API errors and permissions are handled in the panel.

### Explicit Associations

Associations use the built-in Workfront **URL** field on projects and tasks (`URL` in the API); no custom form is needed. One URL is read per record, in any of these formats:

| URL | Association |
| --- | --- |
| `https://da.live/canvas#/org/repo/path` (also `edit#`) | Page `/path` on site `org/repo` |
| `https://da.live/#/org/repo` | Site `org/repo` only |
| `https://main--repo--org.aem.page/path` | Page `/path` on site `org/repo` (any branch) |
| `https://main--repo--org.aem.live/path` | Page `/path` on site `org/repo` (any branch) |

A URL ending in `/` always means that folder's `index` document; otherwise the last path segment names the document. So `…/docs/` is `/docs/index`, while `…/docs` is the `docs` page. Only `https://da.live/#/org/repo` without a trailing slash is a site-only link; `https://da.live/#/org/repo/` is the site's `index` page. Paths are compared case-insensitively and without a `.html` extension. Other URLs are shown but never establish a match.

Linking from the panel writes the page's `https://da.live/canvas#/org/repo/path` URL into an empty URL field. The client rereads the task first, suppresses repeated clicks and treats an existing link to the same page as a no-op. It never replaces a URL that points elsewhere and never automatically retries an uncertain write. Unconfirmed task creation disables resubmission until the dialog is reopened after checking Workfront.

### Matching Rules

- **This page** (default): a URL that points to the open document. A project also matches when one of its tasks is linked to the page.
- **This site**: a URL on that site, whether a site or page link. Tasks inherit their project's site; projects match through tasks linked to the site.
- **Assigned to me / selected user**: exact Workfront assignee IDs, plus tasks assigned only to a job role the user holds (primary or additional role), with parent projects of matching tasks.
- **All**: projects you own or are on (like Workfront's *My Projects*), tasks in those projects, and tasks assigned to you or your job role. Shared projects you can only view, such as request queues, are excluded.
- Search only narrows the chosen context by name; it never establishes relevance.

Every result states why it matched. Status is read-only. Issues, reassignment, status changes, approvals and fuzzy matching are not implemented.

## Verification

Node 18 or later, from the repository root:

```sh
node --test tools/apps/workfront/tests/*.test.js
```

Or run `npm test` inside this directory. No `npm install` is needed. The tests cover explicit matching, duplicate links, task drafts, chat payloads, host context, pagination, permissions and uncertain writes.

Browser-verified embedded workflows include the official SDK MessagePort handshake, current-page context, mocked direct Workfront API responses, in-panel task details, and chat-composer insertion at a 390-pixel panel width. Unit tests verify direct request URLs, refreshed bearer tokens, link and task-creation requests. Real tenant authentication and writes have not been exercised against a live account.

## Assets

- Typography uses the browser's system UI font; no font files are loaded.
- Icons are unmodified local SVGs from Adobe's [Spectrum 2 workflow icons](https://github.com/adobe/spectrum-css-workflow-icons), pinned to `@adobe/spectrum-css-workflow-icons` **5.0.0**. Only the icons used here are included in [assets/icons/](./assets/icons/), along with the upstream [Apache-2.0 license](./assets/icons/LICENSE) and [copyright notice](./assets/icons/COPYRIGHT). CSS masks inherit the surrounding text color; no icon library or external icon requests are needed.
