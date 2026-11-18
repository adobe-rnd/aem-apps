# Content proposals plugin

DA editor Library side panel (`experience: inline`). It shows the open content proposals for the page that is open in the editor or canvas, and lets the page owner act on them.

A content proposal is a folder `/drafts/proposals/{id}/` in the site: one draft page per target and a `proposal.json` record. Agents create it (`create-proposal` skill). This panel reads the same records. See the `review-proposal` and `approve-proposal` skills for the rules it mirrors.

## What it does

- Lists open (and partly merged) proposals whose target is the current page, newest first: title, source → target, summary, change list, and a merge check ("Merges cleanly", or how many blocks also changed on the page since the proposal was opened).
- **Show diff view**: writes the marked page to `/drafts/proposals/{id}/preview/<page>` and opens it in `da.live/canvas`. In that view **Upstream** is the proposed change and **Local** is the page as it is now. Read the markers; do not accept or reject them there.
- **Approve**: asks for a confirmation, merges the draft into the page (three-way smart merge against the proposal's base version, the page's own edits are kept), saves a version "Merged from <draft>", and sets the record to `merged` (or `partially-merged` when other pages remain). It does not preview or publish.
- **Reject**: sets the record to `rejected` with an optional reason. Nothing is merged; the drafts are kept.
- Shows nothing for pages under `/drafts`.

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

## Limits

- A proposal for a page that does not exist yet (no `baseVersionId`) cannot be merged here. Use the agent.
- Reject applies to the whole proposal, not one page.
- Counts of applied and kept blocks are not shown, only skipped blocks.
