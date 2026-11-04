# Block Library Generator V1

Create an initial block library from an Edge Delivery Services site's JavaScript
and CSS. The generator analyses one block at a time, proposes authorable examples,
and saves a library page that authors can review and edit in DA.

**V1 supports Production DA only. Nothing is published.**

## Supported launch modes

| Capability | DA editor extension | DA Apps |
| --- | --- | --- |
| Select site | Uses the editor's site and code branch | Choose a site; code branch is `main` |
| Discover blocks and inspect the library | Yes | Yes |
| Initialize the library | Yes | Yes |
| Open or delete an example page | Yes | Yes |
| Create or recreate examples through chat | Yes | Yes, with nx2 chat support enabled |

Apps generation does not require an open document. It uses the nx2 shell
(`nxver=2`) and the target site's enabled Experience Workspace chat. The generator
checks the host's advertised completion-event capability, not just SDK method
names. Unsupported hosts still allow authorized library management.
The editor route remains available while the Apps-only transition is validated;
its document supplies host context, not example content or images.

## Try the hosted branch (no local setup)

Once `blocklibgen` has been pushed and AEM Code Sync has made the branch available,
testers can use it without cloning the repository, installing tools or running
localhost. These URLs are for that branch, not the current `main` version.

Sign in to Production DA with access to the target site's code, source files,
configuration and Preview operations. Generation requires supported chat and
content-tool integration in the chosen host.

### Generate through Apps

Open the [hosted branch in DA Apps](https://da.live/app/adobe-rnd/aem-apps/tools/apps/block-library-generator/block-library-generator?nxver=2&ref=blocklibgen&da-admin=prod),
choose the content organization/site, then choose **Use site**. This navigates the
Apps wrapper to the selected site so the generator and chat share the same target.
An Apps-index tile can use the same shell URL.

Site-specific example:

```text
https://da.live/app/adobe-rnd/aem-apps/tools/apps/block-library-generator/block-library-generator?nxver=2&ref=blocklibgen&da-admin=prod#/organization/site
```

Use the canonical `#/organization/site` hash. Older `#organization/site` links can
still inspect/manage that site, but must use **Open this site in Apps for chat**
before generation. The app-hosting repository is never the default content target.
**Change site** also navigates the wrapper and obtains a fresh host connection;
finish or cancel any pending action first.

The target site must enable EW/chat, or the browser must already have the supported
EW opt-in. The app does not change those preferences or override disabled chat.
If the host does not advertise support, generation stays disabled with an
explanation. `ref=blocklibgen` selects the generator's code branch; Apps reads the
content site's block code on `main`.

### Existing editor extension

Add this row to the target site's DA configuration **library** sheet:

| title | path | experience |
| --- | --- | --- |
| Block Library Generator | https://blocklibgen--aem-apps--adobe-rnd.aem.live/tools/apps/block-library-generator/block-library-generator.html | fullsize-dialog |

Reload the editor, open a document in the target site, then choose
**Outline > Block Library Generator**. Follow [Use the generator](#use-the-generator)
below to initialize the library and create examples.

The editor supplies its content site and block-code branch independently of the
generator deployment branch.

## Run locally

For development, use the same authenticated launch modes with a local server.

Prerequisites:

- Node.js 22 or newer and the repository's npm dependencies.
- The [AEM CLI](https://github.com/adobe/helix-cli) (`aem`).
- A Production DA login with access to the target site's code, source files,
  configuration and Preview operations.
- Supported chat and content-tool integration for generation.

From the repository root:

```sh
npm ci
aem up --port 3000 --stop-other=false --no-open
```

There is no build step. Both launch modes use the same local server on port 3000.
If that port is occupied, do not stop another project's server.

### Editor extension

Add this row to the target site's DA configuration **library** sheet:

| title | path | experience |
| --- | --- | --- |
| Block Library Generator | http://localhost:3000/tools/apps/block-library-generator/block-library-generator.html | fullsize-dialog |

Reload the editor after changing its configuration, then open a document in that
site and choose **Outline > Block Library Generator**.

### Apps

Open the [local app through the authenticated Apps shell](https://da.live/app/adobe-rnd/aem-apps/tools/apps/block-library-generator/block-library-generator?nxver=2&ref=local&da-admin=prod),
enter the content **Organization** and **Site**, then choose **Use site**.
The app-hosting repository is not automatically the content target.

For a site-specific Apps link, append `#/organization/site` after the query:

```text
https://da.live/app/adobe-rnd/aem-apps/tools/apps/block-library-generator/block-library-generator?nxver=2&ref=local&da-admin=prod#/organization/site
```

The canonical fragment selects the site after authentication; without one,
remembered fields are prefilled but not applied.
Editor launches always retain their own authoritative site and branch.
For hosted branch testing, use `ref=blocklibgen` as shown above instead of
`ref=local`; omitting `ref` loads `main`. An Apps-index tile uses the shell URL,
not the raw localhost URL. Allow the browser's local-network access prompt if
required for local development.

**Apps local chat also requires a local agent on `http://localhost:4002/chat`.**
The host uses `ref=local` for both the app iframe and chat backend. A running
generator on port 3000 alone does not provide a connected chat. Use the hosted
branch for production-agent testing if no local agent is configured; do not
silently override the host's backend selection.

Opening the HTML entry directly does not provide DA authentication or chat.
Use one of the authenticated launch routes above.

## Use the generator

### 1. Check the site and library

Opening the app loads the block inventory and current library status. Select a
block from the list; its badge indicates whether it has a library page or needs
attention. **Refresh blocks** rediscovers code after repository changes.

If setup is missing, choose **Initialize library** and confirm the proposed
destinations. Initialization creates only the missing index and/or Blocks
registration, preserving existing configuration.

Default destinations:

| Purpose | Path |
| --- | --- |
| Blocks index | `/docs/library/blocks.json` |
| Example page | `/docs/library/blocks/<block-name>.html` |
| Shared placeholder images | `/docs/library/media/block-library-generator/` |

An existing valid same-site Blocks registration is honored, including custom
locations. Invalid, inaccessible or ambiguous setup is reported instead of reset.

### 2. Create examples

1. Select a block without a page and choose **Create**.
2. Choose **Continue in chat** to collect fresh sources and prepare the prompt.
   Missing bundled placeholder images are added to the site's library media
   folder at this step.
3. Review and send the prompt in chat. Approve the analysis-result write
   when requested.
4. In Apps, the generator stays beside chat and checks the pending saved analysis
   when a relevant chat turn ends. **Check result** remains available. In the
   editor, reopen the generator and select the block after chat finishes.
5. If the result is ready, choose **Confirm create page**. This separately
   authorizes saving the page and its index entry.
6. Use **Open** to review and edit the saved page in DA.

Preparing a prompt does not submit chat or create a library page. Completion
events are only a signal to validate the owned job's saved result: an unrelated,
aborted or failed turn does not prove that analysis succeeded or failed.
If another block is selected, the app offers **Resume** rather than switching
selection or focus. Reopening checks a pending action once; there is no polling
or automatic redispatch. Final page saving always needs separate confirmation.

If working examples cannot be proposed, either **Retry analysis** after updating
the block's code or choose **Create a default example page**. The separately
confirmed fallback saves one clearly labelled unfinished starter, using an
inferred layout when available or one row with one empty cell otherwise.
Complete its instructions and required values in DA; it may render empty or
report errors until then. It is not a working-example pass.

### 3. Manage existing pages

- **Open:** edit the current page normally in DA. Existing pages are author-owned;
  the generator does not reconstruct their contents from old analysis results.
- **Recreate:** run a fresh analysis, then separately confirm replacement of the
  **entire page, including author edits**. A blocked result can instead offer
  **Replace with a default example page**, with its own replacement confirmation.
- **Delete:** confirm deletion of that example page and its index row. Block code,
  shared assets and unrelated entries remain unchanged.

A library entry without matching block code can still be opened or deleted, but
not recreated. Only one page action is active at a time. Cancelling an action
does not cancel chat or delete its saved analysis.

## How it works

- **Discovery:** resolves the selected site's block entry files. A shared
  metadata-only inventory cache at
  `/.da/block-library-generator/cache/blocks-<branch>.json` is reused until
  **Refresh blocks**. Library configuration, index and page-existence checks
  remain fresh on opening; analysis always reads fresh code.
- **Source collection:** captures block JS/CSS, shared styles and bounded local
  imports, with relevant framework-helper contracts. Project preprocessing is
  outside scope. Unresolved dependencies are recorded; supplied code is not
  executed during analysis. Delivery code uses credential-free browser GETs;
  DA content/configuration access still uses the authenticated SDK. A protected
  or unreadable code asset stops preparation; there is no alternate-origin or
  authenticated fallback to bypass access restrictions.
- **Analysis:** the [analysis prompt](./block-analysis-prompt.txt) distinguishes
  author-selected block classes, body rows/cells, editable rich content,
  configuration-row values and generated runtime behavior. Recipes must be
  rectangular and pass HTML, option, evidence and approved-resource validation.
- **Images and links:** new analyses always use three bundled 640x360 PNG
  placeholders, not images from the launch document. Identical site copies are
  reused; conflicting files are never overwritten. `/index` is the verified
  navigation destination, not a substitute for required media or fragment data.
- **Chat jobs:** immutable requests/results live under
  `/.da/block-library-generator/jobs/<job-id>/`. Results must match the request's
  job, site, branch and block. If inline input exceeds the 256 KiB chat limit,
  chat reads the complete saved request instead; sources are not truncated.
- **Saving:** the generator builds an authorable page with example headings,
  blocks and selector metadata, updates the index, and verifies readbacks.
  Successful normal Create/Recreate removes only that job's request/result and
  matching resume pointer. Blocked, failed and cancelled jobs remain for recovery.

## Preview and write safety

After verified source saving, initialization previews the index;
Create/Recreate preview the page and index; Delete previews the updated index.
**Preview is not Publish.** Deleting DA source does not unpublish delivery copies.

Preview or temporary-job cleanup failures are reported separately and do not
undo a successful page save. Reopening does not silently retry either operation.
If Preview fails, open the reported files in DA and choose **Preview**.

Only an explicit HTTP 404 means a resource is missing. Creates are conditional;
index changes require a specific ETag. Replacement rechecks the confirmed source
and uses its ETag when available. Without one, it compares the source hash before
saving, which cannot eliminate the final read-to-write race.
DA configuration POST and DELETE also lack atomic conditional-write protection.
Avoid concurrent authoring during these actions.

Page, index and configuration writes are not transactional. Partial outcomes stay
visible: inspect and refresh before retrying. There is no automatic rollback,
bulk generation, publishing or block-code modification.

## V1 limitations

- `ready` means the model proposed validated authored candidates, **not** that
  runtime behavior or visual usefulness was verified. Review every saved page.
- Analysis is nondeterministic and can miss conditions, overstate controls or
  misjudge readiness. Structural validation does not prove semantic correctness.
- Examples share an isolated library page. Blocks requiring real media,
  fragments, catalog/order data, authentication, companion blocks or special page
  context may need a starter or further manual work.
- Source collection is bounded to 12 files and three dependency levels, with
  1 MiB/15-second source-read limits; it is not a complete JavaScript resolver.
- Selector heading scrolling depends on the preview renderer and remains tracked
  in [adobe/da-live#1518](https://github.com/adobe/da-live/issues/1518).
- If selector metadata is visible on the rendered site, hide `.library-metadata`
  in site CSS, not its surrounding section, which may contain the actual example.
  Preview caches can briefly show an older index or a cached 404; reload after
  cache expiry rather than regenerating the page.

## Planned after V1

The host changes for Apps chat are available:

- Chat turn-completion events tracked in
  [adobe/da-live#1507](https://github.com/adobe/da-live/issues/1507).
- Apps chat handoff through the SDK in
  [adobe/da-nx#895](https://github.com/adobe/da-nx/pull/895).

Phase 2 wires the supported Apps handoff and completion-triggered result checks.
The next step is a focused end-to-end generation/save/recovery pilot, then retiring
the editor-extension route in favor of Apps-only use. Existing site registrations
are not removed automatically.

## Development checks

From the repository root:

```sh
NODE_OPTIONS=--experimental-vm-modules npm test
npx --no-install eslint tools/apps/block-library-generator/*.js test/tools/apps/block-library-generator/*.test.js
npx --no-install stylelint tools/apps/block-library-generator/block-library-generator.css
npm run license:check
```

The explicit Stylelint command covers the app stylesheet, which is not included
in the repository's normal CSS glob. No live DA credentials are needed for the
offline tests. Live testing requires the authenticated host and separately
approved writes described above.
