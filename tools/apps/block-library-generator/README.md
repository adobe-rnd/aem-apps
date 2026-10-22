# Block Library Generator

A focused POC app for investigating AI-generated block collections. It currently
contains the app shell, DA context/session status, and a gated Stage scratch-job
probe for the chat round trip. There is no block discovery, Cards analysis
integration, final library generation, or publishing.

## Analysis Prompt

The working [block analysis prompt](./block-analysis-prompt.txt) is saved alongside
the app for refinement. It is not yet loaded or executed by the app.

**Status:** prompt refinement is paused while we define the app's end-to-end
workflow. The notes below capture the experiment so far; they do not describe
implemented app functionality.

### Goal and Authoring Model

The intended app will analyse block JavaScript and CSS to generate a block
library with example pages. The prompt currently produces analysis and example
recipes, not rendered or published pages. Its central question is:

> Given the editor's freedom to construct a rectangular rich-content table,
> which author-controlled changes does this block's implementation meaningfully
> interpret?

- The authoring table has a special one-cell header containing the block name
  and instance-wide options, for example `Cards (highlight, alternate)`.
  The header becomes block classes; it is not a body row.
- Authors can add rows and columns, but all body rows have the same cell count.
  Body cells cannot span rows or columns.
- Cells contain rich content, potentially several elements. A column is not
  necessarily a fixed field such as an image or title.
- Options and examples must follow implementation evidence. Distinguish authored
  options from generated classes, content-dependent behavior, and fixed styling.
  Do not invent options or editorial requirements.

### Current Prompt Scope

Inputs are the block's JavaScript and CSS, relevant global stylesheets, and
optional definitions or summaries of helpers actually used by the block.
Existing authored examples can supply additional evidence.

The prompt includes a compact framework contract describing the decorator's
input DOM, generated wrapper/container classes, and exact cell-normalization
rules. This replaces routine inspection of `aem.js`. Cell predicates must be
evaluated after normalization, since wrapping can change child counts.

Loading-lifecycle internals are omitted. Project-specific preprocessing is
explicitly out of scope for now, including inferred link-to-button or automatic
block conversions. Global CSS alone does not establish how an author produces
a styled element.

The requested JSON covers analysis scope, options, structure, content rules,
derived and shared behavior, example recipes, warnings, and unknowns. Findings
must distinguish observed facts from inference and uncertainty, with evidence.
Example bodies must be rectangular and remain unverified until rendered.

### Trials So Far

Both trials used fresh read-only agents against the `ew` example project.
Raw JSON outputs were retained as session artifacts, not added to the app.

| Date | Scope and inputs | Output |
| --- | --- | --- |
| 2026-10-20 | Cards, Columns, and Hero; included framework and project preprocessing source | Seven recipes: two Cards, three Columns, two Hero |
| 2026-10-21 | Cards only; revised framework contract, global styles, and image-helper summary; no framework or project preprocessing source reads | Three recipes: basic text/image cards, text-only cards, and mixed content/order with links |

Both outputs parsed as JSON, contained the ten requested top-level fields, and
had rectangular example bodies. No supported authored block options were found
for the analysed blocks. These checks do not establish semantic correctness,
and no trial examples have been rendered or runtime-tested.

### Open Findings When Prompt Work Resumes

- The first trial incorrectly treated `.columns > div` as matching only the
  first row; it matches every direct row. It also proposed a text-only Hero
  without specifically flagging its white-heading/default-white-background risk.
- Both trials misreasoned about Cards image-cell classification. After a
  picture and text are wrapped into one paragraph, the cell still has exactly
  one element child and a descendant picture. It therefore satisfies the
  image-cell predicate, despite containing mixed content.
- The revised Cards trial suggested a primary-styled link without establishing
  an authoring mechanism for its classes. Styling support is not proof of an
  author-selectable control.
- Evidence references and well-formed JSON do not guarantee correct analysis.
  A possible refinement is to require a normalized-DOM, predicate, and result
  trace for structural classifications. This has not yet been added.

The next step is a bounded editor/chat/result-file proof before further prompt
refinement or implementation of the complete library workflow. Final example-page
creation, library registration, and publication remain outside that proof.

## Workflow Research and Next Step

Tracking: [block library auto-generation #1434](https://github.com/adobe/da-live/issues/1434),
whose discussion identifies [auto setup #1221](https://github.com/adobe/da-live/issues/1221)
as the duplicate target. The [Config Console branch](https://github.com/adobe-rnd/aem-apps/tree/configconsole)
provides prior work on GitHub-backed discovery, example extraction, document
uploads, and library configuration. It does not establish a chat round trip.

### Code Discovery Findings (2026-10-21)

| Operation | Verified behavior |
| --- | --- |
| SDK `actions.daFetch(url, options)` | Can call Helix Admin; endpoint permissions and browser CORS still apply |
| `GET /code/<org>/<site>/<ref>/<path>` | Status of one code resource; a wildcard in the path does not enumerate files |
| Code GET with wildcard `ref` | Lists branches, not files |
| Bulk status with folder wildcards | Traverses authoring/preview/live content, not the code bus |
| `POST /code/<org>/<site>/<ref>/*` | Starts full code synchronization; its job details can provide resource paths |
| `GET /job/<org>/<site>/<ref>/code/<job-id>/details` | Reads an existing code-job result, subject to permissions |

The user supplied a completed full-sync result for `msagolj/boiler/main`.
Its `data.resources` contained eight conventional block candidates: `asset`,
`cards`, `columns`, `footer`, `fragment`, `header`, `hero`, and `testimage`.
Group successful `/blocks/<name>/<name>.js` and `.css` entries by name; retain
zero-byte JavaScript files. Deleted or failed resources are not present-file
evidence. Ignore rules constrain what is eligible for deployment.

**This is discovery through synchronization, not a read-only directory list.**
The POST reads the code source through the platform, writes the code bus, can
remove stale files, and purges affected caches, including live delivery.
The current implementation restricts recursive updates to the root; do not
assume `/blocks/*` is a supported narrower POST.

Any future sync-based discovery must be an explicit user action, not an
automatic refresh on app opening. An existing completed full-sync job can be
read without starting another sync, but it is only a snapshot. Incremental jobs
may list only changed files and must not be presented as a complete inventory.
This avoids direct GitHub requests/credentials in the app, not the platform's
internal use of GitHub.

Sources: [code API](https://github.com/adobe/helix-admin/blob/main/docs/openapi/code-api.yaml),
[GET route](https://github.com/adobe/helix-admin/blob/main/src/codebus/handler.js),
[code lookup](https://github.com/adobe/helix-admin/blob/main/src/support/codebus.js),
[recursive update](https://github.com/adobe/helix-admin/blob/main/src/codebus/update.js),
[job implementation](https://github.com/adobe/helix-admin/blob/main/src/codebus/code-job.js),
and [job API](https://github.com/adobe/helix-admin/blob/main/docs/openapi/job-api.yaml).
No code-sync POST was repeated by the assistant.

### Planned Vertical Slice

1. Confirm the editor target, environment, code branch, and scratch paths.
2. Persist a unique job request under `/.da/block-library-generator/jobs/`.
3. Send a tiny user-reviewed prompt asking chat to write a known JSON result.
   First gate: the app reads the actual agent-written file for that job.
4. Close/reopen the extension and recover the same result without resubmission.
   Second gate: resume works and unrelated results are rejected.
5. Only then use fixed Cards source paths, the existing analysis prompt, global
   styles, and the helper summary to obtain an unrendered analysis draft.

The proof does not depend on block discovery and must not invoke code sync.
No final library pages, current-document edits, registration, deletion, or
publication are part of it. The saved analysis prompt is unchanged.

### Stage Probe: Implemented Controls

This is restricted to an authenticated editor context for `msagolj/ew`, Stage DA
admin `https://stage-admin.da.live`, and site code branch `main`.
Direct/Apps launches, other sites, supplied non-main branches and supplied
non-Stage DA origins cannot prepare or send a probe.

Older hosts do not supply a DA origin or code branch. The app displays that
absence and requires explicit confirmation of the Stage editor/chat target and
`main` branch; it does not infer these from the plugin `ref`.

1. Open the extension from the Stage editor and confirm the target checkbox.
2. Click **Prepare probe**. The app saves a new UUID resume pointer locally,
   checks that the request does not already exist, writes it to Stage, and
   reads it back. A failed readback prevents dispatch.
3. Inspect **Prepared request** and **Prompt to review in chat** if needed.
4. Click **Review in chat**. The app records the handoff attempt, requests
   `setPrompt` with `autoSend: false`, then closes the dialog.
5. Review and submit in chat, approving only the exact Stage result-file write.
   If the available tool cannot explicitly address Stage, stop without writing.
6. Reopen the extension, confirm the target, click **Resume saved probe**, then
   **Check result**. Reopening/resuming never resends the prompt.

Each run uses only:

```text
/.da/block-library-generator/jobs/<job-id>/request.json
/.da/block-library-generator/jobs/<job-id>/result.json
```

The expected final result echoes version, job ID, kind and the fixed target,
with `status: "completed"` and
`payload.message: "block-library-round-trip-ok"`. A final `error` result with
an explanatory string is also recognized, but never treated as success.

Missing result (404), access/server failures, malformed JSON, mismatched
identity/target and invalid markers are separate visible outcomes. Requests
time out after 15 seconds and are aborted on disconnect. Generated content is
shown as text, not executed. No automatic polling is enabled before Gate A.

Preparing another probe requires a second checkbox. It replaces only the local
resume pointer, retains prior scratch files, and does not cancel any chat task.
Scratch cleanup is not automated; remove only explicitly identified run files
after reviewing the evidence. No tokens are saved in the pointer or job data.

### Gate A Verification Status

Protocol and mocked-component checks pass, including write/readback, target
confirmation, single handoff, close/reopen recovery, 404 versus access errors,
wrong-job rejection, and abort-on-disconnect. These are not a live chat proof.

Authenticated verification subsequently used Windows Chrome via DevTools.
The integrated browser is not used for authenticated checks, and credentials
were not copied between browser profiles.

The first live probe used job `b0c3a9aa-4e8c-4e5f-8c77-4ce6da5dab0d`:

| Check | Observed result |
| --- | --- |
| Editor context | Stage `msagolj/ew/index`, with `main` Stage preview |
| App request write/readback | Passed; later authenticated GET returned 200 with the expected job/target |
| Chat handoff | Prompt appeared, dialog closed, and the user submitted it |
| Agent result write | Blocked at capability check; chat reported production-bound content tools with no Stage/environment selector |
| Reopened extension | Recovered the saved job ID; no new prompt was submitted |
| Expected Stage result | Authenticated GET returned 404 |
| Launch document and site config | SHA-256 digests unchanged before/after the probe |

**Gate A is blocked, not passed.** The agent declined before attempting a write;
this was not a failed Stage storage request. Its tool-environment limitation
is reported by chat, not an independent inspection of the backend binding.
Stage-capable content tools or confirmation of an existing Stage binding are
needed before retrying. Do not silently switch to production.

Only the app's request scratch file was created. No agent-written result,
Cards analysis, library pages, code sync, or publication occurred. The existing
request is retained for investigation. Do not manufacture a result file to
satisfy the gate. Automatic polling and Cards integration remain deferred.

### Separate Manual Production Writer Probe (2026-10-22)

The user separately approved and ran a production-chat probe for `msagolj/ew`
without deploying this branch or changing the app's Stage-only safeguards.
Chat reported HTTP 400 on creation and readback of a new scratch `result.json`.
A 400 readback does not confirm that a file is absent, and MIME rejection has
not been established.

The original manual prompt supplied a leading slash in the content tool's
`path` argument. The inspected agent client concatenates
`/source/<org>/<repo>/<path>` without stripping it, producing a double slash.
DA rejects such paths for both reads and writes. An offline check of the actual
DA path parser confirmed that rejection and acceptance of the equivalent
repository-relative `.da/.../result.json` path. The inspected tool schema accepts
a string content type and forwards it as a Blob; no JSON MIME allow-list rejection
was found in that path.

The user reran the corrected prompt with no leading slash in tool arguments,
retaining the `.json` extension and `application/json`. For job
`1e0526b3-f899-4e4f-8b0d-d7b5cba674e8`, the supplied chat report confirms:

- Precheck returned explicit 404.
- Creation succeeded.
- Readback matched the entire requested JSON, including job ID, production
  target and `block-library-round-trip-ok` marker.
- No other files, pages or configurations were changed.

This establishes production chat JSON write/readback capability for this probe,
based on the user's report, and corroborates the path explanation rather than a
MIME restriction. No independent production readback was performed by the
assistant. The file now exists; do not repeat creation at that destination.

Content-tool `path` arguments must be repository-relative (`.da/...`), whereas
site-relative paths (`/.da/...`) remain appropriate for display and correctly
joined source URLs. Carry that distinction into future app-generated prompts.
The app's current prompt still needs that tool-argument clarification before
another app-driven attempt.

This manual result does not pass Stage Gate A or the full app resume/result
flow. Production app testing requires a separate explicit environment decision;
the app remains Stage-only, and Cards integration is still deferred.

Sources: [agent content tools](https://github.com/adobe-rnd/da-agent/blob/3613a887c3aace57c5a84a8ef84ad825ba51a417/src/tools/tools.ts),
[agent DA client](https://github.com/adobe-rnd/da-agent/blob/3613a887c3aace57c5a84a8ef84ad825ba51a417/src/da-admin/client.ts),
and [DA path validation](https://github.com/adobe/da-admin/blob/eb24463b05620b0fd11e63c1c16a3a91a1235ffe/src/utils/daCtx.js).

## Local Development

Run DA from the `da-live` checkout on port 3000 and this repository on port 3001:

```sh
# In da-live
aem up --port 3000

# In aem-apps, on the blocklibgen branch
aem up --port 3001
```

Use a Stage Adobe Identity and verify that your test site exists in stage.
Production site content and configuration are not automatically available there.

The static entry is:

```text
http://localhost:3001/tools/apps/block-library-generator/block-library-generator.html
```

Opening this URL directly checks asset loading but displays `No DA context`.
The DA SDK waits for a parent-window message; query parameters alone do not
initialize a session.

## Stage Registration

Open the local DA configuration editor for your stage test site, for example:

```text
http://localhost:3000/config?da-admin=stage&da-collab=stage#/msagolj/ew/
```

Verify the stage backend before saving. Add this row to the site's **library**
sheet, preserving existing sheets and rows:

| title | path | experience |
| --- | --- | --- |
| Block Library Generator | http://localhost:3001/tools/apps/block-library-generator/block-library-generator.html | fullsize-dialog |

Leave `ref` blank. The Git checkout serving port 3001 determines the app code;
the configuration row's `ref` is an extension visibility filter, not a Git switch.
No `ref=local`, `ref=blocklibgen`, or `nx=local` parameter is needed.

Fully reload the canvas after saving, since configuration is cached:

```text
http://localhost:3000/canvas?da-admin=stage&da-collab=stage#/msagolj/ew/index
```

Substitute an existing stage document if needed. Open **Extensions > Block Library
Generator** from the canvas tools. The full-size dialog receives the current
document's org, site, path, ref, and Stage session token. The SDK is hosted on
`da.live`, but it inherits the parent's session rather than signing in separately.

## Expected States

- `Waiting for DA`: an embedded app is waiting for the SDK handshake.
- `Connected`: the SDK supplied org and site context.
- `No DA context`: direct opening, missing context, or no handshake within ten
  seconds. A late handshake can still connect.
- `Connection error`: SDK loading or initialization failed.

`Token available` indicates only token presence, not verified authorization.
The app never displays, logs, or persists token values. After explicit target
confirmation, the probe uses the SDK's inherited authenticated fetch action
only for its fixed Stage scratch paths. Closing and reopening the dialog starts
a new app instance, which can load its saved resume pointer.

## Validation

```sh
npx --no-install eslint tools/apps/block-library-generator/*.js test/tools/apps/block-library-generator/*.test.js
npx --no-install stylelint tools/apps/block-library-generator/block-library-generator.css
node --experimental-default-type=module --experimental-vm-modules --test test/tools/apps/block-library-generator/*.test.js
npm run license:check
```

The repository's CSS lint script does not include `tools/apps`, so the explicit
Stylelint command is required. The explicit Node flags support this checkout's
ES module tests and the mocked component loader without changing package
metadata. Check desktop and narrow-screen layout, disabled standalone controls,
correct context, token absence/presence, and the real close/reopen flow in the
Stage canvas. Never count a mocked result as Gate A evidence.

## Removal and Publication

Remove only this app's stage library row and fully reload canvas to unregister it.
No `da-live` or `da-nx` source change is needed for this launch method. Standalone
DA Apps launch and shared DA Apps catalog registration are deferred; do not add
localhost URLs to the production catalog.
