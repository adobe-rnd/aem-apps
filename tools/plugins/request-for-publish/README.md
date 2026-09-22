# Publish request

One page-scoped DA/EW plugin with three automatically derived views:

- **Request approval** when the worker returns no own or approvable pending request for this page.
- **Awaiting approval** for a request in the caller's requester queue, with resend and withdrawal.
- **Ready for your review** for a request in the caller's approver queue, with approve-and-publish and rejection.

There is no role selector. When both queues contain the same request, the review view also shows the requester actions. Approver eligibility comes from the worker, not a client-side comparison of email addresses. The full-page publish requests inbox remains available for queue and bulk work.

## Integration

Use `request-for-publish.html` as an **inline** library extension. The same entrypoint works in a fullsize dialog. The default JS export retains the panel `init({ context, token, actions })` contract.

Context accepts `org`, `site` (or legacy `repo`), and a site-relative page `path`. Missing or unsupported context blocks actions. The component reacts to new context properties and ignores superseded reads/actions. The EW iframe host must remount or provide new context on page navigation: the existing SDK only supplies an initial context snapshot.

`request-for-publish.js` bootstraps the SDK and authenticated transport. `panel.js` contains the Lit view. `workflow.js` contains the testable view derivation, client and operation sequencing. Native semantic controls use Spectrum-compatible tokens; no additional UI dependency is required. Legacy `utils.js` remains available for existing imports but is not used by this panel.

## Worker contract

The worker remains unchanged. The panel uses:

- `GET /api/config` and `GET /api/approvers`
- `GET /api/requests` and `GET /api/requests?role=requester`
- `POST /api/requests` (including `resend: true`)
- `POST /api/requests/withdraw`, `/reject` and `/approve`

Preview and publication still happen client-side under the user's session. Submission stops if preview fails. Approval revalidates the request, publishes, then records completion. If publication succeeds but completion fails, the panel offers **Retry request update**, which does not republish. Withdraw and reject require an inline confirmation; rejection also requires a reason. An ambiguous publish response blocks another publication attempt in the panel and directs the user to check the live page. Mutations are not automatically retried.

HTTP failures and malformed queue responses are not treated as empty queues. The panel re-reads after mutations and failures because an email failure may occur after a row was written/deleted. It also refreshes on explicit refresh and return to the document, without background polling. Notes survive failed submission and refresh.

The worker deletes completed requests; it does not supply retained workflow history or an immutable revision/request ID. Disappearance is not proof of approval. Invisible requests belonging to someone else can still cause a duplicate-request error. Duplicate pending rows returned for a page block ambiguous actions. Revalidation reduces stale actions but cannot make publication and workflow completion atomic or repair source-read failures hidden by the worker.

**Review changes** opens the existing Page Status comparison in a new tab. It compares current preview versus live, not unsaved editor edits or a frozen submission version. Preview and publish use the existing main content workflow even when the plugin code comes from a feature branch.

## Configuration

At the site or org level, the worker reads these DA config tabs:

| Tab | Columns / values |
|---|---|
| `publish-workflow-config` | `Pattern`, `Approvers`, `CC` (for example `/drafts/*`, `reviewer@example.com`, empty) |
| `publish-workflow-settings` | `key`, `value`: `request.comments.required`, `request.comments.length`, `request.support.contact`, `approvals.cc.can-approve` |
| `publish-workflow-groups-to-email` | Optional distribution-list expansion; not needed for direct reviewer addresses. |

The worker requires site registration and the caller's DA access to the requests sheet (`/.da/publish-workflow-requests.json`). No registration, permission or worker change is made by the plugin. The worker is authoritative for configuration and comment validation.

## Local verification

Run `npm test` and `npm run lint`. Also run `npx stylelint tools/plugins/request-for-publish/request-for-publish.css`; the repository's default CSS lint glob does not cover tools.

Serve the repository over HTTP and open `/test/fixtures/request-for-publish.html`. The fixture runs browser assertions against the real component with a fake client and displays the results. Add `?view=requester` or `?view=approver` to inspect the other views. No workflow, email or content operation is sent by this fixture.

Worker environments are fixed: localhost defaults to the local worker on port 8787; `?env=ci` selects CI and `?env=prod` explicitly selects production (including from a local plugin). Unknown environment values are rejected. Do not use a real worker for fixture tests.
