# Publish Requests Inbox (v2)

The approver-facing v2 inbox is a thin REST client of
[publish-requests-worker](https://github.com/cloudadoption/publish-requests-worker).
It supports queue, single-page review, and the requester's own requests. The worker
owns identity, authorization, configuration, approval steps, sheet I/O and email;
the inbox publishes content under the approver's Helix session.

## Opting in

V2 is opt-in and requires all three pieces:

1. Deploy a worker with the `/api/v2/` contract described below and register the site with access to its requests sheet.
2. Point the site's inline library entry to `/tools/plugins/request-for-publish-v2/request-for-publish-v2.html`. See the [v2 plugin setup](../../plugins/request-for-publish-v2/README.md#opting-in).
3. Use `/tools/apps/publish-requests-inbox-v2/publish-requests-inbox-v2` for inbox links. Worker v2 emails must link to this inbox, not v1.

For the hosted app, open:

```text
https://da.live/app/adobe-rnd/aem-apps/tools/apps/publish-requests-inbox-v2/publish-requests-inbox-v2?org=my-org&site=my-site
```

The v1 [inbox](../publish-requests-inbox/README.md) and
[plugin](../../plugins/request-for-publish/README.md) remain separate and unchanged.
Installing v2 code alone does not opt a site into v2; do not mix a v1 client with
the v2 workflow.

### URL Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `org` | Yes | Content organization, not the app-host organization. |
| `site` | Yes | Content site / repository. |
| `path` | No | Site-relative page path for single-review mode; omit for the inbox. |
| `env` | No | On non-local hosts, `ci` selects the CI worker; otherwise production is used. Localhost and 127.0.0.1 always use the local worker at port 8787. |
| `ref` | No | App-code branch selector, preserved in review/inbox navigation; does not change the `main` content publish target. |
| `requester` | No | `true` opens My Requests when no path is supplied. It is a view selector, not an identity override. |

Legacy `preview`, `author`, and `comment` parameters are ignored. Requester,
comments and approval data come from the authenticated worker response; preview
links are constructed from the site and validated path.

```text
/tools/apps/publish-requests-inbox-v2/publish-requests-inbox-v2?org=my-org&site=my-site&path=/drafts/my-page&env=ci&ref=rpfix
/tools/apps/publish-requests-inbox-v2/publish-requests-inbox-v2?org=my-org&site=my-site&requester=true
```

## Multi-step approvals

The worker returns `stepInfo`, `canApproveNow`, and `isFinal` for each pending
request. `stepInfo` describes progress; `isFinal` is authoritative for finality.
Never infer permission to publish from step counts or `lastStaffed` alone. Missing
or incomplete approval metadata must fail closed.

Only a currently authorized reviewer can act. **Awaiting other reviewers** means
the request is pending but the caller cannot approve the current step, including
when they are a reviewer of a later step. It is not a publish action.

Intermediate approvals record the expected `step` without publishing and advance
to the next staffed step. Only the last staffed step publishes, and only when the
worker explicitly returns `isFinal: true`. Unstaffed steps are skipped by the
worker. Each staffed step needs any one eligible approver, not every reviewer.

## Worker API

All worker routes below use the full `/api/v2/` prefix. Each call includes `org`
and `site`, with the user's IMS bearer token; identity is derived by the worker.

| Method and route | Contract |
|------------------|----------|
| `GET /api/v2/config` | Display settings; enforcement remains server-side. |
| `GET /api/v2/approvers` | Resolved reviewers and workflow steps for a path. |
| `GET /api/v2/requests` | Approver queue by default; `role=requester` returns the caller's own requests. |
| `GET /api/v2/requests?role=page&path=/page` | Page progress; observer `comment` and `step` log are redacted. This does not grant approval permission. |
| `POST /api/v2/requests` | Create a request; `{ path, resend: true }` resends the requester's pending request. |
| `POST /api/v2/requests/approve` | `{ paths, step }` for intermediate approvals; `{ paths, step, final: true }` for final approvals after confirmed publication. |
| `POST /api/v2/requests/reject` | `{ path, reason }`; reason is mandatory and rejection ends the request. |
| `POST /api/v2/requests/withdraw` | `{ path }`; only the requester can withdraw. |

Use each path's current `step` when approving; group bulk approvals only when the
expected step and finality match. The worker revalidates the stored workflow and
authorization. A final approval requires `final: true`; it is not implied by
publishing first.

The response's `advanced` paths moved to another approval step and must show a
step-approved outcome, not a live link. Only `completed` paths have finished the
workflow and may show the published outcome. `approved` alone is not evidence of
publication. Inspect per-path `stale`, `unauthorized` and `notFound` results;
partial bulk success must not complete failed paths.

- `409` means the request is gone or the step/finality is stale: refresh worker state and require a new decision; never automatically retry the old approval.
- `emailErrors` in a successful response are success warnings: the sheet mutation succeeded but notification delivery failed. Surface the warning and refresh; do not repeat the mutation to resend email.
- `401` is an authentication failure; `403` is an authorization or site-registration denial, not an empty queue.
- `500` and `502` indicate configuration/backend failures, not missing requests or an empty inbox. Keep an error state and refresh after resolving the cause.

## Publication and review

The inbox is **live-only**: it does not save or preview before publish. A final
single approval promotes the current preview with
`POST /live/{org}/{site}/main/{path}`. Bulk publication uses
`POST /live/{org}/{site}/main/*`, polls the job, and records final approvals only
for paths with confirmed success. Intermediate approvals perform no Helix content
operation. Review links compare preview versus live in the Page Status diff tool.

**I-5 remains unresolved: unpinned preview.** The reviewed preview is not frozen
at submission. If an author re-previews before the approval click, live-only
publication can promote content the reviewer did not see. Fixing this requires
the worker to persist a preview baseline at request creation and the client to
verify it before publication; this documentation change does not implement it.
Do not add a fresh preview before approval: that would publish current DA source
rather than the reviewed preview. `ref` does not pin a content revision.

Publication and recording workflow completion are separate operations. A stale
final approval or backend failure can occur after content went live. Refresh and
reconcile the request and live status before another action; do not blindly
republish or treat request disappearance as proof of approval. Completed requests
are deleted; the worker does not retain an immutable approval history.

## Configuration

The worker reads site configuration at
`https://admin.da.live/config/{org}/{site}/`, falling back to
`https://admin.da.live/config/{org}/` when the site has no
`publish-workflow-config` tab. The app reads display settings through
`GET /api/v2/config`.

| Tab | Columns / purpose |
|-----|-------------------|
| `publish-workflow-config` | Canonical `Pattern`, `Workflow`, `Approvers`, `CC`. |
| `publish-workflow-steps` | `Workflow`, `Title`, `Description`, `Approvers`, `CC`, `CC can approve`; row order defines steps. |
| `publish-workflow-groups-to-email` | Optional distribution-list expansion. |
| `publish-workflow-settings` | Comment requirements, support, guidance, theme and inline-rule CC settings. |

The worker reads rules only from the `Pattern` column, in v1 and v2; other
columns such as `Path` are ignored. Header names are matched ignoring case:

| Pattern | Workflow | Approvers | CC |
|---------|----------|-----------|----|
| `/*` | | `web-team@example.com` | |
| `/products/*` | `legal-then-brand` | | |

Named workflows use the ordered rows in `publish-workflow-steps`; inline rules
form a single step. See the [plugin configuration](../../plugins/request-for-publish-v2/README.md#configuration)
for complete examples and matching rules. Pending rows live in
`/.da/publish-workflow-requests.json` with `requester`, `approver`, `path`,
`comment`, `status`, `created`, and the `step` approval log.

## Verification

Run the focused documentation regression:

```sh
node --test test/tools/apps/publish-requests-inbox-v2/docs.test.js
```

Run `npm test` and `npm run lint` for repository validation. These documentation
checks do not prove deployment compatibility or resolve the unpinned preview gap.
