# Publish Requests App

A full-page DA (Document Authoring) application that allows designated approvers to review, approve, or reject content publish requests. This app is the **approver-facing** side of the publish workflow.

## How It Works

### Overview

When an author submits a publish request (via the [Request for Publish Plugin](../request-for-publish-plugin/)), an email notification is sent to the designated approver(s). The approver can either open the app directly (without a `path` parameter) to see **all** pending requests they can act on, or open a specific request link to review a single request.

### Architecture

The app is a **thin REST client of [`publish-requests-worker`](https://github.com/adobe-rnd/publish-requests-worker)** for all workflow bookkeeping. It still publishes content client-side via Helix (under the approver's session); approver resolution, sheet I/O, and email are the worker's job.

- **Web Component**: LitElement custom element (`<publish-requests-inbox>`).
- **DA SDK**: authentication and context.
- **Helix Admin (client-side)**: publishes content — single `POST /live/{org}/{site}/main/{path}` or [bulk publish](https://www.aem.live/docs/admin.html#tag/publish/operation/bulkPublish) `POST /live/{org}/{site}/main/*` (Approve All) — under the approver's session.
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
1. All pending paths are sent in a single `POST` to `https://admin.hlx.page/live/{org}/{site}/main/*`
2. The API returns a job; the app polls it to completion (up to 60 seconds, every 2 seconds)
3. On completion, the app checks the job details for per-resource status codes
4. For the successfully published paths, the app makes a single `POST /api/requests/approve` — the **worker** removes those pending rows and emails the authors
5. If some paths failed, only the succeeded ones are approved and a summary is shown

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

### 11. Missing Configuration

If the `publish-workflow-config` tab is not found in the DA config at either the site level (`/config/{org}/{site}/`) or the org level (`/config/{org}/`), the app displays an error message:

> *"Publish workflow configuration not found. Please ensure the "publish-workflow-config" tab exists in the DA config for site "{org}/{site}" or org "{org}"."*

This prevents the app from operating without proper approver rules.

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
| `error` | Missing required URL parameters, auth failure, or missing workflow configuration |
