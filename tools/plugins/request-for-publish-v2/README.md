# Publish request (v2)

This is the **v2** plugin. It lives at `tools/plugins/request-for-publish-v2/` beside the unchanged v1 plugin (`tools/plugins/request-for-publish/`), and talks only to the worker's `/api/v2/*` routes. Sites opt in by pointing their library entry at `/tools/plugins/request-for-publish-v2/request-for-publish.html`; sites still on v1 are unaffected.

One page-scoped DA/EW plugin showing a page's approval flow as an ordered list of steps. A request advances one step at a time; the page is published only when the last step is approved.

Every view renders the same stepper. Steps already approved show a check mark and the approver; the step awaiting a decision shows an inline **Approve** button when the caller may act on it; later steps are greyed out. Expanding a step reveals its detail — approval time for completed steps, the approver list for upcoming ones, and the request actions for the current one. All steps are collapsed by default.

There is no role selector. When the caller is both the requester and an approver of the current step, the current step offers both sets of actions. A user with no stake in a pending request — including an approver of a later step — gets the same stepper read-only, so they can see the request's progress without being offered the submission form. Approver eligibility comes from the worker, not a client-side comparison of email addresses. The v2 inbox (`tools/apps/publish-requests-inbox-v2/`) remains available for queue and bulk work.

## Integration

Use `request-for-publish.html` as an **inline** library extension. The same entrypoint works in a fullsize dialog. The default JS export retains the panel `init({ context, token, actions })` contract.

Context accepts `org`, `site` (or legacy `repo`), and a site-relative page `path`. Missing or unsupported context blocks actions. The component reacts to new context properties and ignores superseded reads/actions. The EW iframe host must remount or provide new context on page navigation: the existing SDK only supplies an initial context snapshot.

`request-for-publish.js` bootstraps the SDK and authenticated transport. `panel.js` contains the Lit view. `workflow.js` contains the testable view derivation, client and operation sequencing. Native semantic controls use Spectrum-compatible tokens; no additional UI dependency is required.

## Worker contract

The panel uses the worker's v2 API:

- `GET /api/v2/config` and `GET /api/v2/approvers` (the latter also returns the matched `workflow` and its ordered `steps`)
- `GET /api/v2/requests`, `GET /api/v2/requests?role=requester` and `GET /api/v2/requests?role=page&path=` (the page-scoped read, which ignores the caller's role so an uninvolved user sees that a request already exists)
- `POST /api/v2/requests` (including `resend: true`)
- `POST /api/v2/requests/withdraw`, `/reject` and `/approve`

`POST /api/v2/requests/approve` carries the step the client believes is current. The worker re-derives it from the stored log and returns the path under `stale` when they disagree, so an out-of-date panel cannot approve a step twice or skip ahead. Every pending row carries `canApproveNow` (false when the caller approves some later step but not the current one) and `stepInfo`; the panel takes the current step from `stepInfo` and only derives it from the log when the worker omits it.

Preview and publication still happen client-side under the user's session. Submission waits for a confirmed editor save, then previews, then sends the request. A failed save or preview stops submission. Approving an intermediate step only writes the log and notifies the next step's approvers — no content operation, so only the final approval can leave the page published with the request unrecorded. That case still offers **Retry request update**, which does not republish. Withdraw and reject require an inline confirmation; rejection also requires a reason and ends the request outright, discarding the step log with the row. An ambiguous publish response blocks another publication attempt in the panel and directs the user to check the live page. Mutations are not automatically retried.

HTTP failures and malformed queue responses are not treated as empty queues. The panel re-reads after mutations and failures because an email failure may occur after a row was written/deleted. It also refreshes on explicit refresh and return to a visible browser tab, without background polling. Moving focus between the center comparison and the rail does not restart loading or disable the next interaction. Notes survive failed submission and refresh.

The worker deletes completed requests; it does not supply retained workflow history or an immutable revision/request ID. Disappearance is not proof of approval. Invisible requests belonging to someone else can still cause a duplicate-request error. Duplicate pending rows returned for a page block ambiguous actions. Revalidation reduces stale actions but cannot make publication and workflow completion atomic or repair source-read failures hidden by the worker.

**Review changes** invokes the native EW center comparison while leaving this rail mounted. Authors compare the **current document versus live**, both before submission and while their request is pending. The approver view compares **preview versus live**, matching the content that approval publishes. Reviews are read-only: opening comparison never saves or previews. It does not compare a frozen submission revision.

Native comparison requires deployment of both the EW host implementation and the SDK actions. There is no external Page Status fallback. A missing `actions.openComparison` method disables **Review changes**. Method presence checks only whether the SDK exposes the action; it does not prove that the embedding host supports it.

The SDK's `actions.openComparison({ candidate, baseline })` and `actions.closeComparison()` are synchronous, fire-and-forget methods returning `undefined`. The consumer does not await host acknowledgement or require `{ ok }` comparison results. The adapter exposes immediately resolving async review/close methods so existing promise callers remain safe; those promises confirm dispatch only, not that comparison opened or closed. No capability declarations or handshake flags are required. The public host action remains role-agnostic; this plugin chooses the comparison inputs from its worker-derived view.

Before every submission, even when no comparison was opened, the integrated client awaits `actions.saveDocument()`. This separate action must return `{ ok: true }` to confirm current editor edits are saved; it may return `{ ok: false, error }` on failure. A missing method, rejected promise, failure reply, or invalid/undefined result blocks both preview and the request. The client's `beforePreview` save gate is mandatory and must also return that confirmation. Deployment of the host save implementation and SDK method is a submission prerequisite; hosts without them cannot silently skip saving. Approval does not save or preview: it publishes the current preview as before. Successful workflow transitions dispatch close comparison; failed/unknown publication also dispatches close to avoid leaving misleading pre-publication content visible.

Preview and publish use the existing main content workflow even when the plugin code comes from a feature branch.

## Configuration

At the site or org level (site config wins when it has a `publish-workflow-config` tab), the worker reads these DA config tabs:

| Tab | Columns / values |
|---|---|
| `publish-workflow-config` | `Path` (v1 `Pattern` also accepted), `Workflow`, `Approvers`, `CC` |
| `publish-workflow-steps` | `Workflow`, `Title`, `Description`, `Approvers`, `CC`, `CC can approve` — one row per step |
| `publish-workflow-settings` | `key`, `value`: `request.comments.required`, `request.comments.length`, `request.support.contact`, `request.guidance.title`, `request.guidance.text`, `request.guidance.item.N`, `request.guidance.item.N.marker`, `theme.accent-color`, `theme.accent-color-hover`, `approvals.cc.can-approve` (inline rules only) |
| `publish-workflow-groups-to-email` | Optional distribution-list expansion; not needed for direct reviewer addresses. |

### Submission guidance

Sites can show a checklist before authors request approval. Nothing is shown unless at least one `request.guidance.*` key is set. `request.guidance.title` and `request.guidance.text` are an optional heading and introduction; `request.guidance.item.N` adds checklist items in ascending `N`, and the optional `request.guidance.item.N.marker` shows a short badge such as a letter of an acronym. Empty items are ignored.

`request.support.contact` is an email address. The pending author sees "If your content owner is away, contact … for assistance with content approvals."; every other view offers a **Contact support** link.

### Steps

Each `publish-workflow-config` row maps a `Path` (exact path, `/a/*` or `/*`) either to a named `Workflow` or to inline `Approvers`/`CC`:

| Path | Workflow | Approvers | CC |
|---|---|---|---|
| `/*` | | `web-team@example.com` | |
| `/products/*` | `legal-then-brand` | | |

An inline rule is a single, untitled step with exactly the v1 behavior: `CC` is copied, and may approve, only when `approvals.cc.can-approve` is `true`. A rule naming a `Workflow` takes its steps from `publish-workflow-steps` and ignores its own `Approvers`/`CC`:

| Workflow | Title | Description | Approvers | CC | CC can approve |
|---|---|---|---|---|---|
| `legal-then-brand` | Legal review | Claims and disclaimers | `dl-legal@example.com` | | |
| `legal-then-brand` | Brand review | Tone and imagery | `brand@example.com, jane@example.com` | `watcher@example.com` | `true` |

Row order within a workflow is the step order; there are no step numbers to keep in sync. `Title` falls back to `Step N`, and a missing description renders nothing. `CC` addresses are notified when their step becomes active and may approve it only when that row's `CC can approve` is `true`. A step completes when **any one** of its approvers approves. A step whose approvers resolve to nobody is skipped and rendered as such. A workflow name with no rows behaves like an unmatched path: no approvers.

`/a/*` matches `/a` and paths below it on a segment boundary only. When two rules have the same path, the first row wins.

### Request state

`publish-workflow-requests` has a `step` column holding an append-only log of approvals (the step number is the row position within the workflow):

```
legal@example.com:1:2026-09-23T10:14:00Z, brand@example.com:2:2026-09-23T11:02:00Z
```

The current step is derived by the worker, not stored: the highest approved step plus one, skipped forward over approver-less and already-logged steps. Concurrent approvals of the same step therefore collapse rather than advancing the request twice. Editing a workflow while requests are pending re-evaluates them against the new definition. Timestamps are ISO; no field may contain a comma.

The worker requires site registration and the caller's DA access to the requests sheet (`/.da/publish-workflow-requests.json`). No registration or permission change is made by the plugin. The worker is authoritative for configuration, step resolution and comment validation.

## Local verification

Run `npm test` and `npm run lint`. Also run `npx stylelint tools/plugins/request-for-publish-v2/request-for-publish.css`; the repository's default CSS lint glob does not cover tools.

Serve the repository over HTTP and open `/test/fixtures/request-for-publish.html`. The fixture runs browser assertions against the real component with a fake client and displays the results. Add `?view=requester` or `?view=approver` to inspect the other views. No workflow, email or content operation is sent by this fixture.

Worker environments are fixed: localhost defaults to the local worker on port 8787; `?env=ci` selects CI and `?env=prod` explicitly selects production (including from a local plugin). Unknown environment values are rejected. Do not use a real worker for fixture tests.

The production worker at this branch’s baseline does not allow localhost origins in CORS. `env=prod` cannot bypass that policy. Local testing can use `env=ci` after a CI worker with the exact localhost:3000 exception is deployed, or use plugin code served from an allowed HTTPS origin. CI is not a data sandbox: it can access real DA content and send notifications. Local fixtures remain backend-free.

## Native comparison integration verification

This consumer does not contain the EW comparison implementation or depend on MSM merge resolution. The host implementation lives in da-live; the SDK methods live in da-nx. Both need to be deployed for native review; confirmed saving also requires both sides of the save action.

`test/fixtures/comparison-plugin.html` and `test/fixtures/comparison-plugin.js` mount the real panel and workflow client with an SDK supplied by a separate integration harness. `test/fixtures/comparison-panel-tests.html` runs the panel browser assertions when that harness serves this checkout under `/plugin` and supplies its local Lit dependency and host styles. The standalone panel assertions remain at `/test/fixtures/request-for-publish.html`.

The integration harness is managed outside this repository; use its provided local URL rather than a retired showcase server. Workflow operations in these fixtures are in memory: no notifications or remote content mutations. They validate interaction and sequencing, not authenticated publication.
