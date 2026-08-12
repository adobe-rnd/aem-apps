# Tags

A standalone app for visually managing a site's tag taxonomy and
bulk-searching pages by tag. Companion to the
[tags plugin](../../plugins/tags/README.md), which authors use to pick tags
from the same `taxonomy.json` sheet while editing a page — this app is where
that sheet gets created, edited, and published.

## How to Use

1. Enter an **Organization** and **Site**, then **Load**.
2. **Editor tab** — add namespaces, categories (nestable), and tags; drag the
   `⠿` handle to reorder or move something into a different category/
   namespace. **Save** writes a draft to DA source (visible to the tags
   plugin immediately). **Publish** makes that draft live.
3. **Find pages tab** — pick a tag and, optionally, a subfolder to scope the
   crawl to, then **Find pages**. Runs on demand only; checks each page's
   metadata block for a `Tags` entry matching the selected tag.

## Configuring

Register the app in a site's DA config sheet, **apps** tab (`title` /
`description` / `image` / `path` columns), with the org/site baked into the
`path` so it opens pre-scoped to that site:

| title  | description                              | image           | path |
| ------ | ----------------------------------------- | --------------- | ---- |
| `Tags` | Manage tag taxonomy and find tagged pages | *(an icon URL)* | `/app/adobe-rnd/aem-apps/tools/apps/tags/tags?org={org}&site={site}` |

e.g. `/app/adobe-rnd/aem-apps/tools/apps/tags/tags?org=toyota-motor-north-america&site=aemeds-toyota-racing`

Append `&taxonomy={path-or-url}` to that same `path` for sites that keep
`taxonomy.json` somewhere other than the default location — same override
as the tags plugin's own `?taxonomy=` param (see its README).

The app also works opened directly with no params (enter org/site and
**Load**), and remembers the most recently loaded location in
`localStorage` for next time.

## Taxonomy format

Same flat `Namespace`/`Category`/`Tag`/`Description` sheet the tags plugin
reads — see its README for the format details. The editor presents it as a
tree and always serializes back to that same row format, so anything saved
here opens correctly in the plugin unmodified. One house rule: within a
namespace or category, its direct tags always come before its
sub-categories (existing sheets that don't follow this still parse fine).

## Bulk search assumption

Matches tags found in a page's metadata block — a `Tags` row (case
insensitive) with a comma-separated list of tag paths. This isn't enforced
by the tags plugin (it inserts tag paths as plain text at the cursor), so
search results depend on tags actually being placed in that block.

## Files

| File        | Purpose                                                    |
| ----------- | ----------------------------------------------------------- |
| `tags.html` | App shell (importmap, DA SDK, nx2 styles)                    |
| `tags.js`   | `<tagger-app>` Lit component: nav, editor, search UI         |
| `tags.css`  | nx2 Spectrum-branded styles                                  |
| `api.js`    | DA source fetch/save, AEM admin preview/publish, crawl+fetch search |
| `taxonomy.js` | Taxonomy location resolving, sheet fetching, and flat-row \<-\> tree conversion — **imported directly by [the tags plugin](../../plugins/tags/README.md)**, so this is the one canonical implementation of the `taxonomy.json` contract |

## Dependencies

- [DA App SDK](https://da.live/nx/utils/sdk.js) — context and token
- [`daFetch`](https://da.live/nx/utils/daFetch.js) — authenticated fetch with token refresh
- [DA Tree Utility](https://da.live/nx/public/utils/tree.js) — site crawling for bulk search
- [`da-lit`](/tools/deps/lit/dist/index.js) — Lit, for the app's UI component
- [nx2 Spectrum Styles](https://da.live/nx2/styles/styles.css) — design system
- No build step; plain ES modules
