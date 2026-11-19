# Content proposals plugin

DA editor Library side panel (`experience: inline`). It shows the open content proposals for the page that is open in the editor or canvas, and lets the page owner act on them.

A content proposal is a folder `/drafts/proposals/{id}/` in the site: one draft page per target and a `proposal.json` record. Agents create it (`create-proposal` skill). This panel reads the same records. See the `review-proposal` and `approve-proposal` skills for the rules it mirrors.

## What it shows, by page

The panel shows every proposal the open page is involved in, whatever its role:

| Page open | Shown | Actions |
|---|---|---|
| **Target** page | Open proposals for this page: summary, changes, merge check. Closed ones are listed under "Closed". | Show diff view, Approve, Reject |
| **Source** page | The proposal with one block per target page: state, changes, merge check, and links to the target page and the proposed (draft) page. | Show diff view and Approve per target page, and Reject for the whole proposal |
| **Draft** page (`/drafts/proposals/{id}/…`) | The proposal for the target this draft belongs to, with links to the target and source pages. | Same as target |
| **Diff view** page (`/drafts/proposals/{id}/preview/…`) | Same as the draft page. Approve or reject right where you read the markers. | Same as target |

Other pages show "No content proposals involve this page".

## Create a proposal

**Create proposal…** (top of the panel, on any page outside `/drafts`) lists the target pages of the open page from the site's locations config, nested ones indented. Ticking a page also ticks the pages it depends on. **Send to chat** puts a ready request into the chat and sends it (`actions.setPrompt(text, { autoSend: true })`):

```
Create a content proposal for the latest changes on /index-ready.html.
Compare the page with its previous saved version to find the changes.
Targets:
- Canada (English) (en-CA): /en-ca/index-ready.html
Do not write to the target pages.
```

The `create-proposal` skill does the work, including Experience Context. The panel writes nothing. If the host has no `setPrompt`, the request is copied to the clipboard; if that fails, it is shown for copying. To only fill the chat box without sending, change `autoSend` in `create.js`.

## Actions

- **Show diff view**: writes the marked page to `/drafts/proposals/{id}/preview/<page>` and opens it in `da.live/canvas`. In that view **Upstream** is the proposed change and **Local** is the page as it is now. Read the markers; do not accept or reject them there.
- **Approve**: asks for a confirmation, merges the draft into the page (three-way smart merge against the proposal's base version, the page's own edits are kept), saves a version "Merged from <draft>", and sets the record to `merged` (or `partially-merged` when other pages remain). It does not preview or publish.
- **Reject**: sets the record to `rejected` with an optional reason. Nothing is merged; the drafts are kept. It rejects the whole proposal, not one page.

## Setup

Add a row to the site `library` sheet (DA editor → Library). Prototype branch URL shown; use `main--aem-apps--adobe-rnd` once merged:

| title | path | icon | experience |
| --- | --- | --- | --- |
| Content proposals | `https://msm-loc-prototype--aem-apps--adobe-rnd.aem.live/tools/plugins/proposals/proposals.html` | `https://da.live/blocks/edit/img/S2_Icon_FileText_20_N.svg#S2_Icon_FileText` | inline |

## How it merges

The merge engine is da-nx's own: `smartMerge`, `regionalDiff` and `getBlockHashes` from `https://da.live/nx/public/loc/regional-diff.js`. `merge.js` is the glue (the same steps as the `page_merge` MCP tool): read the draft, the page and the base version; refuse a page with unresolved markers; merge; write with `If-Match`; save a version.

## Files

| File | Job |
| --- | --- |
| `proposals.js`, `.css`, `.html` | Panel UI |
| `model.js` | Pure helpers: parse records, match a page, record updates, paths |
| `store.js` | DA reads and writes (source, versions, proposals list) |
| `merge.js` | Merge check, diff preview and merge, with the engine injected |
| `create.js` | Target pages from the locations config, the chat request, sending it to the chat |

## Limits

- A proposal for a page that does not exist yet (no `baseVersionId`) cannot be merged here. Use the agent.
- Reject applies to the whole proposal, not one page.
- Counts of applied and kept blocks are not shown, only skipped blocks.
