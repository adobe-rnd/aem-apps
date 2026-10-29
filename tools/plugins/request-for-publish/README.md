# Request for Publish Plugin

A plugin for Experience Workspace (EW) that enables content authors to submit publish requests for approval. This plugin is the **author-facing** side of the publish workflow, appearing as a dialog within EW.

## Prerequisites

Your Adobe contact onboards the org and site for the publish workflow (see [Get onboarded](https://www.aem.live/docs/ew/administering/request-publish#step-1-get-onboarded)). The workflow configuration and requests-sheet access described under **Configuration** must also be set up.

## Installation

Add this row to the `prepare` tab or the `library` tab of the site config at `https://da.live/config#/{org}/{site}/`:

| title             | path                                                                                                    | icon                                                                                                   | experience        |
| ----------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------- |
| `Request Publish` | `https://main--aem-apps--adobe-rnd.aem.live/tools/plugins/request-for-publish/request-for-publish.html` | `https://main--aem-apps--adobe-rnd.aem.live/tools/plugins/request-for-publish/request-for-publish.svg` | `fullsize-dialog` |

- In the `prepare` tab, authors open it from the Prepare menu, for pages and for media such as PDFs.
- In the `library` tab, authors open it from the side panel dropdown, for pages only.

Add it to both tabs only if you want it in both places. Save the config and reload the EW canvas editor.

## How to Use

1. Open the page you want to submit in EW.
2. Open **Request Publish** from the Prepare menu or the side panel dropdown, depending on where it is registered.
3. Review the approvers and content diff, add a note if needed, and click **Request Publish**.

## How It Works

### Overview

When an author finishes editing content and wants to publish it, they open the plugin from the side panel dropdown in EW. The plugin automatically detects the current content path, identifies the appropriate approvers and CC recipients from the workflow configuration (including resolving distribution list groups), and lets the author submit a publish request with an optional note. The designated approvers then receive a notification (email) with CC recipients copied, along with a link to the [Publish Requests App](../../apps/publish-requests-inbox/) where they can review and approve or reject the request.

### Architecture

The plugin is a **thin REST client of [`publish-requests-worker`](https://github.com/cloudadoption/publish-requests-worker)**. It no longer resolves approvers or reads/writes the requests sheet itself — the worker is the single source of truth for approver resolution (pattern matching + DL-group expansion), sheet I/O, and email.

- **Web Component**: LitElement custom element (`<request-for-publish>`).
- **App SDK**: authentication, context (org, site, path), and dialog rendering.
- **publish-requests-worker (REST)** — the plugin calls:
  - `GET /api/approvers` — resolved approvers + CC for the path
  - `GET /api/config` — workflow config (for display-only settings, e.g. comment requirements)
  - `POST /api/requests` — submit a request (worker resolves approvers, records the row, emails approvers + CC)
  - `POST /api/requests/withdraw` — cancel the author's own pending request
  - `GET /api/requests?role=requester` — the author's own pending requests
- **Helix Admin (client-side)**: previews the page under the user's session before submitting; the worker never calls Helix.
- **Adobe IMS**: the user's IMS token is sent to the worker, which **derives the caller's identity from it** (the plugin never sends an email/approver list). The plugin also reads the user's email from the IMS profile for display.
- **Dual Mode**: fullsize-dialog (HTML entry point) or EW panel plugin (exported `init`).

### Initialization & submission flow

1. The plugin reads the user's email (IMS profile, for display) and the content path from the App SDK context.
2. It calls `GET /api/config` (display settings) and `GET /api/approvers` (resolved approvers + CC). If the worker reports missing config or no matching rule, an error is shown and the form is hidden.
3. It calls `GET /api/requests?role=requester` to detect an existing pending request by this user for this path; if found, a "Request Pending" state is shown instead of the form.
4. The author optionally reviews the diff, adds a note, and clicks **Request Publish**.
5. The plugin previews the page via Helix (client-side), then `POST /api/requests` — the worker resolves approvers, records the pending row, and emails approvers + CC. A success confirmation lists the notified recipients.

### Approver resolution (server-side)

Approver/CC resolution — specificity-based pattern matching against the `publish-workflow-config` rules and distribution-list expansion via `publish-workflow-groups-to-email` — is performed by **`publish-requests-worker`**, not the plugin. See that repo for the matching semantics and rule format. The plugin only displays the approvers the worker returns; if no rule matches the path, the worker returns none and the plugin shows an error.

## Use Cases Handled

### 1. Submit a New Publish Request

The primary use case. The author sees the content path, preview URL, resolved approvers and CC recipients (with DLs expanded), and a content diff link. They add a description/note (optional by default; mandatory when `request.comments.required` is `true` in `publish-workflow-settings`) and submit. This:
- Sends the request via the Cloudflare Worker which emails the approvers (with CC recipients copied) with a review link
- Records the pending request in the requests sheet (requester, approver, path, comment, status)
- Shows a success confirmation with the list of notified approvers and CC'd recipients

### 2. Existing Pending Request Detection

If the author already has a pending request for the same content path, the plugin shows a "Request Pending" state instead of the form. This prevents duplicate submissions and displays:
- The content path
- The assigned approver
- The current status (`pending`)
- A note asking the author to wait for the existing request to be reviewed

### 3. Review Content Diff Before Submitting

Before submitting, the author can click the diff link to open the AEM Page Status diff tool (`https://tools.aem.live/tools/page-status/diff.html`). This shows a comparison of the preview (draft) content versus the currently live/published version, helping the author verify their changes are correct before requesting approval.

### 4. View Preview

The plugin generates and displays a preview URL (`https://main--{site}--{org}.aem.page/{path}`) that the author can click to see how the content will look when published.

### 5. Approver Transparency

The plugin clearly shows which approvers and CC recipients will receive the request (with DLs fully resolved to individual names), along with the source of the detection:
- **Config-based**: "Approvers and CC determined by content path rules" — matched from the workflow config
- **Error**: If no matching rule is found or the config is missing, an error message is shown instead of the form

### 6. Missing Configuration

If the `publish-workflow-config` tab is not found in the EW config at either the site level (`/config/{org}/{site}/`) or the org level (`/config/{org}/`), the plugin displays an error:

> *"Publish workflow configuration not found for this site or org."*

Add the tab at one of those levels.

Similarly, if the config exists but no rule matches the current content path, an error is shown:

> *"No approver rule found matching path "{path}". Please add a matching pattern to the "publish-workflow-config" tab."*

In both cases, the submission form is not rendered and the author cannot submit a request.

### 7. Session/Auth Issues

If the user's email cannot be determined from the Adobe IMS token (e.g., expired session), the submit is blocked with an error message: "Could not determine your email. Please try again."

### 8. Submission Failure Handling

If the request fails to submit (network error, worker error, etc.), an error message is displayed and the form remains active so the author can retry.

## File Structure

| File | Description |
|------|-------------|
| `request-for-publish.html` | Entry HTML for fullsize-dialog mode; loads the App SDK and the plugin module |
| `request-for-publish.js` | Main LitElement component with form, states, and event handlers; includes both dialog and panel mode initialization |
| `request-for-publish.css` | Styles for all component states (form, pending, success, loading) |
| `utils.js` | Thin REST client over `publish-requests-worker` (approvers/config fetch, submit/resend/withdraw, existing-request check) + client-side Helix preview + IMS profile fetch |

## Configuration

### EW config API (approver rules + groups)

The workflow configuration is read from the **EW config API** as tabs within the root config:

- **Site-level** (primary): `GET https://admin.da.live/config/{org}/{site}/`
- **Org-level** (fallback): `GET https://admin.da.live/config/{org}/`

These tabs are read by **`publish-requests-worker`** (for approver resolution and rule enforcement); the plugin only reads display-only settings from them via `GET /api/config`. The config is a multi-sheet JSON with these tabs:

- **`publish-workflow-config`** tab: Path-based rules with `Pattern`, `Approvers`, `CC`, and `NotifyOnReject` columns. Patterns support wildcards (e.g., `/drafts/*`, `/*`)
- **`publish-workflow-groups-to-email`** tab: Maps distribution list group names (e.g., `dl-reviewers@example.com`) to comma-separated individual email addresses
- **`publish-workflow-settings`** tab: Key-value settings for the publish workflow (see below)

If the `publish-workflow-config` tab is not found at either level, the plugin shows an error message and disables submission.

#### `publish-workflow-settings` tab

The `publish-workflow-settings` tab holds key-value pairs that control optional workflow behavior. Add a row for each setting:

| Key | Value | Description |
|-----|-------|-------------|
| `request.comments.required` | `true` or `false` | When `true`, the description field ("Please provide a description of your website content changes...") becomes mandatory. Default: `false`. |
| `request.comments.length` | number | Minimum character length for the description when comments are required. Fallback: `10` if missing or invalid. |

**Example:**

| key | value |
|-----|-------|
| `request.comments.required` | `true` |
| `request.comments.length` | `25` |

### `/.da/publish-workflow-requests.json` (EW source API)

Tracks pending publish requests with columns: `requester`, `approver`, `path`, `comment`, `status`, `created`

**Access requirements:** the worker reads and writes this sheet **on the author's behalf, using the author's forwarded IMS token** — so authors still need **write access** to `/{org}/{site}/.da/publish-workflow-requests.json` for the Request Publish workflow to work.

Configure access in the EW config at `/config/{org}/` (or `/config/{org}/{site}/` if using site-level config). Grant the IMS group that contains your authors **write access** to the `/{org}/{site}/.da/publish-workflow-requests.json` sheet. Without this permission, the worker's write fails and the request is rejected.

## Plugin Modes

### Fullsize Dialog Mode (Primary)

The plugin runs as a standalone page loaded in an EW dialog. The HTML file bootstraps the App SDK, and the component self-initializes by reading context from the SDK.

### Panel / Sidekick Mode (Available)

The plugin exports a default `init` function compatible with the plugin panel API. This allows it to be rendered in a sidebar panel, though the dialog mode is the primary usage pattern.

```javascript
export default async function init({ context, token }) {
  return {
    title: 'Request Publish',
    panel: {
      render: (container) => { /* mounts the component */ },
    },
  };
}
```

## States

The plugin renders one of these states at any time:

| State | Trigger |
|-------|---------|
| Loading | Initial load, fetching user profile and approver config |
| Form | No existing pending request; ready for submission |
| Pending | An existing pending request for this path/user already exists |
| Submitted | Request was successfully submitted |

## Troubleshooting

- **Plugin missing from the Prepare menu or the side panel dropdown:** Check that the site's `prepare` or `library` tab contains the registration row. Save the config and reload the EW canvas editor.
- **Plugin does not open:** Check that `path` is the full `.html` URL shown above and `experience` is `fullsize-dialog`.
- **Submission is blocked:** Check the displayed error, workflow configuration, your sign-in session, and the requests-sheet access requirements above.
