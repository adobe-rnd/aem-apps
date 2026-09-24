# Publish request

One page-scoped DA/EW plugin showing a page's approval flow as an ordered list of steps. A request advances one step at a time; the page is published only when the last step is approved.

Every view renders the same stepper. Steps already approved show a check mark and the approver; the step awaiting a decision shows an inline **Approve** button when the caller may act on it; later steps are greyed out. Expanding a step reveals its detail — approval time for completed steps, the approver list for upcoming ones, and the request actions for the current one. All steps are collapsed by default.

There is no role selector. When the caller is both the requester and an approver of the current step, the current step offers both sets of actions. A user with no stake in a pending request — including an approver of a later step — gets the same stepper read-only, so they can see the request's progress without being offered the submission form. Approver eligibility comes from the worker, not a client-side comparison of email addresses. The full-page publish requests inbox remains available for queue and bulk work, but is not yet step-aware.

## Integration

Use `request-for-publish.html` as an **inline** library extension. The same entrypoint works in a fullsize dialog. The default JS export retains the panel `init({ context, token, actions })` contract.

Context accepts `org`, `site` (or legacy `repo`), and a site-relative page `path`. Missing or unsupported context blocks actions. The component reacts to new context properties and ignores superseded reads/actions. The EW iframe host must remount or provide new context on page navigation: the existing SDK only supplies an initial context snapshot.

`request-for-publish.js` bootstraps the SDK and authenticated transport. `panel.js` contains the Lit view. `workflow.js` contains the testable view derivation, client and operation sequencing. Native semantic controls use Spectrum-compatible tokens; no additional UI dependency is required. Legacy `utils.js` remains available for existing imports but is not used by this panel; it resolves the IMS profile host through `ims-profile.js`, so a stage or local session reads the caller's email from the IMS environment that issued the token. `plugin.js` is a separate, panel-free entry point for the browse status surface (see below).

## Worker contract

The panel uses:

- `GET /api/config` and `GET /api/approvers` (the latter also returns the ordered `steps` for the path)
- `GET /api/requests`, `GET /api/requests?role=requester` and `GET /api/requests?role=page&path=` (the page-scoped read, which ignores the caller's role so an uninvolved user sees that a request already exists)
- `POST /api/requests` (including `resend: true`)
- `POST /api/requests/withdraw`, `/reject` and `/approve`

`POST /api/requests/approve` carries the step the client believes is current. The worker re-derives it from the stored log and returns the path under `stale` when they disagree, so an out-of-date panel cannot approve a step twice or skip ahead. Rows returned in the approver queue carry `canApproveNow`, which is false when the caller approves some later step but not the current one.

Preview and publication still happen client-side under the user's session. Submission stops if preview fails. Approving an intermediate step only writes the log and notifies the next step's approvers — no content operation, so only the final approval can leave the page published with the request unrecorded. That case still offers **Retry request update**, which does not republish. Withdraw and reject require an inline confirmation; rejection also requires a reason and ends the request outright, discarding the step log with the row. An ambiguous publish response blocks another publication attempt in the panel and directs the user to check the live page. Mutations are not automatically retried.

HTTP failures and malformed queue responses are not treated as empty queues. The panel re-reads after mutations and failures because an email failure may occur after a row was written/deleted. It also refreshes on explicit refresh and return to a visible browser tab, without background polling. Moving focus between the center comparison and the rail does not restart loading or disable the next interaction. Notes survive failed submission and refresh.

The worker deletes completed requests; it does not supply retained workflow history or an immutable revision/request ID. Disappearance is not proof of approval. Invisible requests belonging to someone else can still cause a duplicate-request error. Duplicate pending rows returned for a page block ambiguous actions. Revalidation reduces stale actions but cannot make publication and workflow completion atomic or repair source-read failures hidden by the worker.

**Review changes** invokes the native EW center comparison while leaving this rail mounted. Authors compare the **current document versus live**, both before submission and while their request is pending. The approver view compares **preview versus live**, matching the content that approval publishes. It does not compare a frozen submission revision. There is no external comparison fallback.

The separate EW host/SDK capability is detected from the host handshake (`comparison: 1`), not just the existence of a JavaScript method. The public host action remains role-agnostic; this plugin chooses the comparison inputs from its worker-derived view.

Before submitting, the integrated client invokes the separate `saveDocument: 1` capability to confirm current editor edits are saved. Failure or an unsupported host blocks preview and submission rather than silently reviewing one state and staging another. Approval does not save or preview: it publishes the current preview as before. Successful workflow transitions close comparison; failed/unknown publication also closes it to avoid leaving misleading pre-publication content visible.

Preview and publish use the existing main content workflow even when the plugin code comes from a feature branch.

## Configuration

At the site or org level, the worker reads these DA config tabs:

| Tab | Columns / values |
|---|---|
| `publish-workflow-config` | `Pattern`, `Approvers`, `CC` (for example `/drafts/*`, `legal@example.com:1, brand@example.com:2`, `watcher@example.com:2`) |
| `publish-workflow-settings` | `key`, `value`: `request.comments.required`, `request.comments.length`, `request.support.contact`, `approvals.cc.can-approve`, `workflow.step.N.title`, `workflow.step.N.description` |
| `publish-workflow-groups-to-email` | Optional distribution-list expansion; not needed for direct reviewer addresses. |

### Steps

Each entry in `Approvers` and `CC` may carry a step suffix, `<email>:<step>`. A bare address without a suffix belongs to step 1, so existing single-step configurations keep working unchanged. The same address may appear on several steps. Distribution-list groups take a suffix too, and every expanded address inherits it.

The number of steps is the highest step referenced in the matched pattern's `Approvers`. Titles and descriptions are decoration only: `workflow.step.N.title` falls back to `Step N`, and a missing description renders nothing. These keys are global — patterns with different approver sets share them.

A step with no approvers is skipped and rendered as such. Because step count comes from `Approvers`, this only happens for gaps between assigned steps, for example approvers on steps 1 and 3 but none on step 2.

A step completes when **any one** of its approvers approves. `CC` addresses for a step are notified when that step becomes active, and may approve it only when `approvals.cc.can-approve` is true.

### Request state

`publish-workflow-requests` has a `step` column holding an append-only log of approvals:

```
legal@example.com:1:2026-09-23T10:14:00Z, brand@example.com:2:2026-09-23T11:02:00Z
```

The current step is derived, not stored: the highest approved step plus one, skipped forward over approver-less and already-logged steps. Concurrent approvals of the same step therefore collapse rather than advancing the request twice. Timestamps are ISO; no field may contain a comma.

## Browse status surface (`plugin.js`)

DA's browse list can show a page's pending publish request as a status cell in
the item's details drawer. `plugin.js` is the module that serves it. It is a
sibling of `request-for-publish.js` on purpose: the editor entry point loads
the DA editor styles and the Lit component at import time, and the browse list
must not pay for those just to ask whether a page has a pending request.

Declare it with a `library` config row on the site (or org) config:

| title | surface | module | label | icon | kinds |
|---|---|---|---|---|---|
| Request Publish | status | `/tools/plugins/request-for-publish/plugin.js` | Workflow | workflow | page |

Behaviour:

- The module's `init({ context, token })` returns a handle with
  `async getStatus(item, ctx)`.
- A page with a pending request gets `{ state: 'pending', label: 'In Review',
  icon: 'clock' }`. A page with none returns `null`, which renders nothing.
  `pending` is the only state the list ever sees, because approve, reject and
  withdraw delete the row.
- Matching is on `item.sitePath`, the site-relative extensionless form the
  worker stores (`/tea2` for `/bpauli/frescopa/tea2`). A folder index is
  browsed as `/de/index`, so a request recorded against the folder `/de`
  matches it too.
- The popover detail (requester, approver, comment, created) comes from the
  request row itself, plus an origin-relative link to the inbox app, so a local
  run links to the local inbox. There is no second network call.
- Pending requests are caller-scoped, so the module lists both
  `role=requester` and the default (no `role` param) approver-scoped queue,
  then dedupes by path. The host caches nothing and calls `getStatus` once per
  expand, so the listing is fetched once per `init` and shared by every item
  in the list.
- `ctx.token` is the raw IMS token: `daFetch` only attaches credentials for DA
  and AEM origins, so the worker would otherwise get an unauthenticated call.

The full host contract is `blocks/browse/da-list/status-registry/README.md` in
`da-live`.

The worker requires site registration and the caller's DA access to the requests sheet (`/.da/publish-workflow-requests.json`). No registration or permission change is made by the plugin. The worker is authoritative for configuration, step resolution and comment validation.

## Local verification

Run `npm test` and `npm run lint`. Also run `npx stylelint tools/plugins/request-for-publish/request-for-publish.css`; the repository's default CSS lint glob does not cover tools.

Serve the repository over HTTP and open `/test/fixtures/request-for-publish.html`. The fixture runs browser assertions against the real component with a fake client and displays the results. Add `?view=requester` or `?view=approver` to inspect the other views. No workflow, email or content operation is sent by this fixture.

Worker environments are fixed: localhost defaults to the local worker on port 8787; `?env=ci` selects CI and `?env=prod` explicitly selects production (including from a local plugin). Unknown environment values are rejected. Do not use a real worker for fixture tests.

The production worker at this branch’s baseline does not allow localhost origins in CORS. `env=prod` cannot bypass that policy. Local testing can use `env=ci` after a CI worker with the exact localhost:3000 exception is deployed, or use plugin code served from an allowed HTTPS origin. CI is not a data sandbox: it can access real DA content and send notifications. Local fixtures remain backend-free.

## Decoupled native comparison showcase

This branch is an adapter on top of `pubrail`. It does not contain the EW comparison implementation or depend on MSM merge resolution. The host implementation lives in da-live; the additive SDK methods live in da-nx.

The da-live comparison fixture server accepts this checkout as `--plugin=/absolute/path/to/aem-apps`. Open:

- `http://localhost:3010/test/fixtures/comparison.html?plugin=publish&view=author`
- `http://localhost:3010/test/fixtures/comparison.html?plugin=publish&view=approver`
- `http://localhost:3011/plugin/test/fixtures/comparison-panel-tests.html` for browser assertions.

The showcase mounts the real panel, workflow client, SDK and cross-origin iframe bridge with simulated content/queues. All workflow operations are in memory: no notifications or remote content mutations. This fixture is for interaction validation, not authenticated publication validation.
