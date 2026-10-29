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
| Create or recreate examples through chat | Yes | Not yet supported by the Apps host |

Generation currently requires an open document in the supported DA editor.
The document supplies the authenticated host context, not example content or
images. Apps-only generation is deferred until the host supports chat handoff
and responses; both launch routes remain available in V1.

## Run locally

Prerequisites:

- Node.js 22 or newer and the repository's npm dependencies.
- The [AEM CLI](https://github.com/adobe/helix-cli) (`aem`).
- A Production DA login with access to the target site's code, source files,
  configuration and Preview operations.
- An editor with the supported chat and content-tool integration for generation.

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

For a deployed extension, replace the localhost path with the deployed app's HTML
entry URL and keep `fullsize-dialog`. The app's deployment branch is separate from
the target site's code branch.

### Apps

Open the [local app through the authenticated Apps shell](https://da.live/app/adobe-rnd/aem-apps/tools/apps/block-library-generator/block-library-generator?ref=local&da-admin=prod),
enter the content **Organization** and **Site**, then choose **Use site**.
The app-hosting repository is not automatically the content target.

For a site-specific Apps link, append `#organization/site` after the query:

```text
https://da.live/app/adobe-rnd/aem-apps/tools/apps/block-library-generator/block-library-generator?ref=local&da-admin=prod#organization/site
```

`#/organization/site` is also accepted. A valid fragment selects the site after
authentication; without one, remembered fields are prefilled but not applied.
Editor launches always retain their own authoritative site and branch.
For a deployed Apps launch, omit `ref=local`. An Apps-index tile uses the shell
URL, not the raw localhost URL. Allow the browser's local-network access prompt
if required for local development.

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
3. Review and send the prompt in editor chat. Approve the analysis-result write
   when requested.
4. When chat finishes, reopen **Block Library Generator**, select the block and
   choose **Check result** if needed.
5. If the result is ready, choose **Confirm create page**. This separately
   authorizes saving the page and its index entry.
6. Use **Open** to review and edit the saved page in DA.

Preparing a prompt does not submit chat or create a library page. The generator
does not automatically poll or reopen itself when chat finishes.

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
  executed during analysis.
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
