# Block Library Generator

Generate a block library with example pages from an Edge Delivery Services site's
JavaScript and CSS. Use the examples as a starting point, then review and edit
them in DA.

The app runs in **DA Apps** and uses **Production DA**. It previews saved content
but never publishes it.

## Open the app

[Open Block Library Generator](https://da.live/app/adobe-rnd/aem-apps/tools/apps/block-library-generator/block-library-generator?nxver=2&ref=blocklibgen)

You need:

- A DA login with access to the site's code, content, configuration and Preview.
- Experience Workspace chat enabled for the selected site or through your
  browser's supported EW opt-in.

Enter the content **Organization** and **Site**, then choose **Use site**.
You do not need to open a document in the editor.

To open a particular site directly, append `#/organization/site`:

```text
https://da.live/app/adobe-rnd/aem-apps/tools/apps/block-library-generator/block-library-generator?nxver=2&ref=blocklibgen#/organization/site
```

Use the same URL for an entry in your site's **apps** sheet.

- `nxver=2` selects the Apps shell that supports chat.
- `ref=blocklibgen` selects the app's code branch, not the content site.
- `#/organization/site` selects the site whose library you want to manage.

Choose **Change site** to select another target. Finish or cancel any pending
action before switching. The app reads block code from the content site's `main`
branch.

The internal HTML page cannot be used directly or as an editor extension.

## Set up the library

The app lists the site's blocks and shows whether each has an example page.
Choose a block to see its available actions.

If the library is not configured, choose **Initialize library**, review the
destinations, then confirm. The app creates only the missing index or Blocks
registration and preserves existing configuration.

Default locations:

| Content | Location |
| --- | --- |
| Blocks index | `/docs/library/blocks.json` |
| Example pages | `/docs/library/blocks/<block-name>.html` |
| Placeholder images | `/docs/library/media/block-library-generator/` |

An existing valid Blocks registration is used instead, including a custom
library location.

## Create an example page

1. Select a block without an example page and choose **Create**.
2. The app collects the sources, submits the analysis to chat, validates its
   result, saves the page and Blocks-index entry, and previews both.
   **Approve the analysis-result write in chat if requested** by the host.
3. Choose **Open** when creation finishes, then review and edit the examples in DA.

**Create authorizes the whole new-page operation.** There is no separate prompt
submission or final page-save confirmation. Existing pages are never replaced
by Create, and nothing is published.

The selected block stays active while creation runs. You can cancel during
preparation or chat; cancelling does not stop chat. Use **Recovery options** only if a
step is interrupted or chat finishes without a saved page.

### When examples cannot be generated

If analysis cannot produce working examples, Create automatically saves a
clearly labelled unfinished default page instead.

The default page uses an inferred layout when available, otherwise one row with
one empty cell. Open it in DA and supply usable values or required external
content. It may render empty or report errors until completed.
Source-access errors and invalid analysis results stop creation; they do not
silently become default pages.

## Manage existing pages

- **Open** opens the current page in DA for normal authoring.
- **Recreate** runs a fresh analysis. Confirming the result replaces the
  **entire page, including any author edits**. If analysis is blocked, you can
  separately confirm replacement with a default page instead.
- **Delete** removes the example page and its Blocks-index entry. It does not
  delete block code, shared images or unrelated pages.

Generated pages belong to authors once saved. The app does not synchronize later
edits with old analysis results.

Only one page action is active at a time. **Resume** returns to a pending action.
Cancelling the action does not stop chat or delete its saved analysis.

## How it works

### Source-based analysis

The app discovers block JS/CSS files and reads fresh sources for each analysis,
including shared styles and relevant local imports. The
[analysis prompt](./block-analysis-prompt.js) asks chat to identify:

- Author-selected block options.
- Row and cell structure.
- Editable text, headings, images, links and configuration values.
- Restrictions, dependencies and meaningful example variations.

Source code is analysed, not executed. The app validates the returned recipes
and checks that the result belongs to the pending block and site.

The discovered block list is cached. Use **Refresh blocks** after repository
changes. Library configuration and page status are checked again when opening
the app.

### Example content

New analyses use three bundled placeholder images, not images from an editor
document. Missing copies are added to the site's library media folder; existing
conflicting files are not overwritten.

Real video, fragment, form or catalog references cannot be replaced by those
images. Blocks that need unavailable resources may only support a default page.

### Saving and Preview

The app saves an authorable page with example headings, blocks and selector
metadata, updates the index, and verifies the saved content.

Library setup previews the index. Create/Recreate preview the page and index.
Delete previews the updated index. **Preview is not Publish**, and deleting DA
source does not unpublish an existing delivery copy.

## Limitations and recovery

- AI analysis can miss behavior or propose unsuitable examples. A ready analysis
  is not proof of working runtime output: review every saved page.
- Examples share an isolated library page. Blocks requiring authentication,
  external data, companion blocks or special page context may need manual work.
- Source collection is bounded; it is not a complete JavaScript resolver.
  Unreadable code and unresolved dependencies are reported.
- Avoid concurrent editing while initializing, recreating or deleting content.
  Detected changes stop the action, but not every DA write is atomic.
- Page and index writes can partially succeed. Read the reported outcome and
  inspect the saved content before retrying. An interrupted save is not retried
  automatically when the app reopens.
- Preview or temporary-analysis cleanup can fail after a successful save.
  These warnings do not mean the page was lost. For a Preview warning, open the
  reported file in DA and choose **Preview**.
- If chat ends without a result, check for pending approvals and use
  **Recovery options > Check result**. Reopening checks a pending analysis and
  can finish its authorized Create, but does not resend the prompt.
- If generation is unavailable, check `nxver=2`, site access and EW/chat
  availability. Authorized library management can still be used without chat.

Production is the default DA environment. If your browser remembers Stage or a
local service, add `&da-admin=prod` to the Apps URL.

## Run locally

For local development, use Node.js 22 or newer and the
[AEM CLI](https://github.com/adobe/helix-cli). From the repository root:

```sh
npm ci
aem up --port 3000 --stop-other=false --no-open
```

[Open the local app through DA Apps](https://da.live/app/adobe-rnd/aem-apps/tools/apps/block-library-generator/block-library-generator?nxver=2&ref=local)
and select the content site. Allow the browser's local-network access prompt
if needed.

**Local chat also requires a local agent on `http://localhost:4002/chat`.**
The shell uses `ref=local` for both the app and chat backend. A server on port
3000 alone is not enough for generation; use the hosted app if no local agent is
configured.
