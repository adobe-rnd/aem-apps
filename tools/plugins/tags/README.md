# Tags plugin

A multi-select, searchable tag picker for authors, backed by a site's tag
taxonomy sheet (`/taxonomy.json` by default). To create or edit that sheet,
or to find which pages already carry a given tag, see the companion
[Tags app](../../apps/tags/README.md).

Ported from
[scdemos/demo's `tools/plugins/tags`](https://github.com/scdemos/demo/tree/main/tools/plugins/tags),
adapted for a flat `Namespace`/`Category`/`Tag`/`Description` taxonomy
sheet (fetched from the DA source API rather than a `docs/library/*.json`
file), and generalized to work across orgs/sites and to let each site
configure where its taxonomy sheet lives.

## How it works

- Reads the taxonomy sheet's **DA source** (not the published site) so
  authors see taxonomy edits immediately, without needing to publish
  first.
- Tags are grouped under a collapsible heading per `Namespace`, with an
  optional `Category` shown as a badge; search filters across tag,
  namespace, category, and description.
- A category is itself selectable, alongside anything nested under it — e.g.
  both `Tag Driven:catlev1` and `Tag Driven:catlev1/Alpha` can be applied.
- Multi-select via checkboxes, with a running summary of selected tags
  above the action buttons.
- **Send Selected** inserts the selected tags' taxonomy paths at the
  author's cursor. **Read Selection** loads the picker from whatever
  taxonomy paths are in the document's current text selection, useful for
  editing tags a page already has (DA plugins can only read/write the
  current selection, not the document generally). **Reset** clears the
  picker back to its initial state.

## Taxonomy location

By default the plugin fetches `taxonomy.json` from the current site's DA
source root (`/source/{org}/{repo}/taxonomy.json`). A site can point it
elsewhere with a `taxonomy` query param on the plugin URL, set in the
`path` column of the DA config library row (see **Registration** below):

- A path within the site's own DA source, e.g.
  `/tools/plugins/tags/tags.html?taxonomy=/config/taxonomy.json`
- A full DA source URL, to share one taxonomy sheet across multiple
  sites/orgs, e.g.
  `/tools/plugins/tags/tags.html?taxonomy=https://admin.da.live/source/{org}/{repo}/taxonomy.json`

## Registration

DA discovers plugins via a row in the site's DA config sheet (Site
**CONFIG** > **library**), not a file in this repo. Someone with DA admin
access needs to add:

| title  | path                                                                                                    | icon                                                                                                    | experience |
| ------ | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------- |
| `Tags` | `https://tags--aem-apps--adobe-rnd.aem.live/tools/plugins/tags/tags.html`                                | `https://tags--aem-apps--adobe-rnd.aem.live/tools/plugins/tags/classification.svg`                         | `dialog`?  |

Append `?taxonomy=...` to the `path` for sites that keep `taxonomy.json`
somewhere other than the default location (see **Taxonomy location**
above).

## Dependencies

Resolving the taxonomy location, fetching the sheet, and parsing its rows
are shared with the [Tags app](../../apps/tags/README.md) via
`tools/apps/tags/taxonomy.js` — one canonical implementation of the
`taxonomy.json` contract for both.
