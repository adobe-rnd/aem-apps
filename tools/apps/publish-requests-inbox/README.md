# Publish Requests App

A full-page DA (Document Authoring) application that allows designated approvers to review, approve, or reject content publish requests. This app is the **approver-facing** side of the publish workflow.

## How It Works

### Overview

When an author submits a publish request (via the [Request for Publish Plugin](../request-for-publish-plugin/)), an email notification is sent to the designated approver(s). The approver can either open the app directly (without a `path` parameter) to see **all** pending requests they can act on, or open a specific request link to review a single request.

### Architecture

The app is a **thin REST client of [`publish-requests-worker`](https://github.com/cloudadoption/publish-requests-worker)** for all workflow bookkeeping. It still publishes content client-side via Helix (under the approver's session); approver resolution, sheet I/O, and email are the worker's job.

- **Web Component**: LitElement custom element (`<publish-requests-inbox>`).
- **DA SDK**: authentication and context.
- **Helix Admin (client-side)**: publishes content — single `POST /live/{org}/{site}/main/{path}` or [bulk publish](https://www.aem.live/docs/admin.html#tag/publish/operation/bulkPublish) `POST /live/{org}/{site}/main/*` (Approve All) — under the approver's session. Helix 6 sites (the admin ping announces `x-api-upgrade-available`) use `https://api.aem.live/{org}/sites/{site}/live/...` instead. If the ping fails, the inbox treats the site as legacy, as it did before Helix 6 support, and pings again on the next call.
- **DA Admin (client-side)**: after a confirmed publish, the inbox creates an **Approved & Published** version for an existing DA page or JSON sheet. It skips media files. The approver needs DA read and write access to the source. If the source check or version fails, the inbox shows a warning without undoing the publish. The version captures the current DA source, not the published preview. On DA, creating this version updates the source's last-modified time. When the site's content source is the AEM source bus (the sidekick config's content source, not the admin ping, which also flags sites that only have a source-bus overlay), the inbox creates the version there (`POST /{org}/sites/{site}/source/{path}/.versions` on `api.aem.live`, the label as `comment`). If the ping or the sidekick config can't be read, or the config names no content source, the inbox uses DA. The source-bus call answers 404 for a missing source and leaves the source's last-modified time alone. Version requests start at least 125 ms apart. A version request that gets a 429 waits and is sent again. One that gets a 503 or a network error is not, because the server may already have created the version.
- **publish-requests-worker (REST)** — the app calls:
  - `GET /api/requests` — pending requests the caller can approve; `?role=requester` for the caller's own
  - `GET /api/approvers`, `GET /api/config` — resolved approvers / config (display)
  - `POST /api/requests/approve` — record approval (remove rows + email authors) after publishing
  - `POST /api/requests/reject` — reject (remove row + email author)
  - `POST /api/requests` `{ resend: true }` and `POST /api/requests/withdraw` — for the my-requests view
- **Adobe IMS**: the user's token is sent to the worker, which **derives identity from it**; the app also reads the user's email from the IMS profile for display.

### Two Operating Modes

#### Inbox Mode (no `path` parameter)

Opened with `org` and `site`: the app calls `GET /api/requests`, which returns only the pending requests the caller is **authorized to approve** (the worker does the matching, DL expansion, and `cc.can-approve` check). It renders per-request approve/review/diff actions plus an **Approve All** bulk action.

#### Single-Review Mode (with `path` parameter)

Opened from an approval-email link with a `path`: the app finds that path in `GET /api/requests` to confirm it's pending and approvable, then renders the full review interface (diff, approve, reject).

### Approver resolution (server-side)

Specificity-based pattern matching against `publish-workflow-config` and distribution-list expansion via `publish-workflow-groups-to-email` are performed by **`publish-requests-worker`** — `GET /api/requests` already returns only the caller's approvable requests, and `GET /api/approvers` returns the resolved list for a path. See that repo for the matching semantics and rule format.

### URL Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `org`     | Yes      | The DA organization (e.g., `my-org`) |
| `site`    | Yes      | The DA site / repository (e.g., `my-site`) |
| `path`    | No       | The content path to review. If omitted → inbox mode |
| `author`  | No       | Email of the author who submitted the request |
| `preview` | No       | URL to the preview version of the content |
| `comment` | No       | Comment/note from the author |

**Inbox URL (all pending requests):**
```
/tools/publish-requests-inbox/publish-requests-inbox?org=my-org&site=my-site
```

**Single-review URL (specific request):**
```
/tools/publish-requests-inbox/publish-requests-inbox?org=my-org&site=my-site&path=/drafts/my-page&author=author@example.com
```

## Use Cases Handled

### 1. View All Pending Approvals (Inbox)

The landing page when no `path` is specified. Displays a list of all pending publish requests that the logged-in user is authorized to approve. Each item shows the content path, requester, the author's comment (if provided), and action buttons (Diff, Review, Approve).

### 2. Approve All Pending Requests (Bulk Publish)

From the inbox, the approver can click **"Approve All"** to bulk-publish all visible pending requests in a single operation using the [AEM Admin bulk publish API](https://www.aem.live/docs/admin.html#tag/publish/operation/bulkPublish).

**How it works:**
1. The inbox sends the pending paths in one `POST` to `https://admin.hlx.page/live/{org}/{site}/main/*` (Helix 6: `https://api.aem.live/{org}/sites/{site}/live/` with `forceAsync: true`).
2. The API returns a job. The inbox polls it every 2 seconds, for up to 60 seconds.
3. The inbox sends one `POST /api/requests/approve` for the confirmed paths. The **worker** removes those pending rows and emails the authors. Unconfirmed paths remain in the inbox.
4. The inbox then tries to create an **Approved & Published** DA version for each confirmed page or sheet.

### 3. Author Email Notification on Publish

After a successful publish (single, inbox, or bulk), the app calls `POST /api/requests/approve` for the published paths; the **worker** emails the original author(s) — one consolidated email per author listing their just-published pages, with live links. On bulk publish with partial failures, only authors of succeeded pages are notified.

### 4. Approve a Single Request from Inbox

Each inbox item has an individual **"Approve"** button that publishes just that one request. The item is removed from the list upon success, and a publish notification email is sent to the author.

### 5. Review & Approve a Single Request

The full review page for a specific request. The approver sees the content path, author, author's comment (loaded from the requests sheet or URL params), preview link, and a content diff link. They can click **"Approve & Publish"** to publish the content. A publish notification email is sent to the author upon success.

### 6. Reject a Publish Request

From the single-review page, the approver provides a mandatory reason and clicks **"Reject Request"**. The app calls `POST /api/requests/reject`; the worker removes the pending row and emails the author (and DigiOps) the reason.

### 7. Review Content Diff

Both the inbox (per-item) and the review page provide links to the AEM Page Status diff tool, allowing the approver to compare preview vs. live content before making a decision.

### 8. No Pending Request

If an approver opens a link for a request that has already been processed, the app shows a "No Pending Request" page with a link back to the inbox.

### 9. Unauthorized Access

If a user is not an authorized approver for the given content path (after group resolution), the app shows a "Not Authorized" page listing who is authorized.

### 10. Empty Inbox

If the user has no pending requests to act on, the inbox displays an empty state message.

### 11. Site Not Set Up

Before loading requests, the app checks that the site exists, is registered with the worker (`GET /api/site-config`), and has `publish-workflow-config` rules in the site or org config. If it isn't registered (`404` with `availableProviders`) or has no rules, it shows **Not Set Up Yet** with a link to the [Publish Requests Setup](../publish-requests-setup/README.md) app and a **Check Again** button. A site or org config that doesn't exist (`404`) counts as having no rules. If either config can't be read, or the worker can't say (no access, an outage, or no `/api/site-config` route), the app carries on and lets the worker gate each call. When the site's content source is the AEM source bus, the site config is `config/editor/da.json` on `api.aem.live`, the org config stays on DA, and the DA org listing isn't checked because it doesn't show those sites. The app reads the content source from the sidekick config only for sites the admin ping flags with `x-api-upgrade-available`: the ping also flags a DA site that only has a source-bus overlay, and that site keeps its config on DA. If the ping or the sidekick config can't be read, or the config names no content source, the app reads the site from DA, as it did before Helix 6 support.

The link is always the plain production URL `https://da.live/app/adobe-rnd/aem-apps/tools/apps/publish-requests-setup/publish-requests-setup?org={org}&site={site}`, with the values URL-encoded. It never carries `ref` or `env`, even when the inbox itself was opened with them, and opens in a new tab.

A **Resend** whose approvers or CC include an email domain the site doesn't allow (`allowedEmailDomains` in its registration, else `adobe.com`) answers `403` ("One or more approver or CC email domains are not allowed for this org"), and nothing is sent. The inbox shows it as a recipient-domain problem, naming the domains when the worker sends them, with a hint that a config admin can allow them under Registration in the setup app; it is not a registration or setup problem.

### 12. Session/Login Issues

If the user's email cannot be determined from the Adobe IMS token, a warning is shown and action buttons are disabled.

## File Structure

| File | Description |
|------|-------------|
| `publish-requests-inbox.html` | Entry HTML that loads DA SDK and the app module |
| `publish-requests-inbox.js` | Main LitElement component with inbox and review modes, all UI states and event handlers |
| `publish-requests-inbox.css` | Styles for all component states (inbox, review, approved, rejected, error, etc.) |
| `api.js` | Thin REST client over `publish-requests-worker` (list/approve/reject/withdraw/resend, approvers/config) + client-side Helix publish (single & bulk) + job polling + IMS profile fetch |

## Configuration

### DA Config API (approver rules + groups)

The workflow configuration is read from the **DA Config API** as tabs within the root config:

- **Site-level** (primary): `GET https://admin.da.live/config/{org}/{site}/`
- **Org-level** (fallback): `GET https://admin.da.live/config/{org}/`

These tabs are read by **`publish-requests-worker`** (approver resolution + rule enforcement); the app reads display-only settings via `GET /api/config`. The config is a multi-sheet JSON with these tabs:

- **`publish-workflow-config`** tab: Path-based rules with `Pattern`, `Approvers`, `CC`, and `NotifyOnReject` columns
- **`groups-to-email`** tab: Maps distribution list names to comma-separated individual email addresses

If the `publish-workflow-config` tab is not found at either level, the app shows an error.

### `/.da/publish-workflow-requests.json` (DA Source API)

Tracks pending publish requests with columns: `requester`, `approver`, `path`, `comment`, `status`, `created`

## States

The app renders one of these states at any time:

| State | Trigger |
|-------|---------|
| `loading` | Initial load, fetching user profile and data |
| `inbox` | No `path` param — shows all pending requests for the user |
| `review` | Valid pending request found and user is authorized |
| `approved` | Content successfully published |
| `rejected` | Request successfully rejected and notifications sent |
| `no-request` | No pending request found for the given path |
| `unauthorized` | Current user is not an authorized approver (after group resolution) |
| `site-not-found` | The org exists but has no such site |
| `not-set-up` | Unregistered or no approval rules; links to the setup app |
| `error` | Missing required URL parameters or auth failure |
