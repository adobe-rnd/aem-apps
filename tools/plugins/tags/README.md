# Tags plugin

A multi-select, searchable tag picker for authors, backed by a site's tag
taxonomy sheet (`/taxonomy.json` by default). To create or edit that sheet,
or to find which pages already carry a given tag, see the companion
[Tags app](../../apps/tags/README.md).

Ported from
[scdemos/demo's `tools/plugins/tags`](https://github.com/scdemos/demo/tree/main/tools/plugins/tags),
adapted for a flat `Namespace`/`Category`/`Tag`/`Description` taxonomy
sheet (fetched from the source API rather than a `docs/library/*.json`
file), and generalized to work across orgs/sites and to let each site
configure where its taxonomy sheet lives.

## Prerequisites

The site needs a `library` tab in its Experience Workspace (EW) site config at `https://da.live/config#/{org}/{site}/`. Follow [Set up library](https://www.aem.live/docs/ew/administering/set-up-library#update-project-config-sheet) first. The installation instructions assume that setup is complete and that you can edit the config. The taxonomy sheet must also exist at the configured location.

## How to use

1. Open a page in EW and switch to **Content** view.
2. Place the cursor where you want to insert tags, or select existing taxonomy paths to edit.
3. Open the plugin from the side panel dropdown and select **Tags** (or its configured title).
4. Select tags and click **Send Selected** to insert them. Use **Read Selection** to load existing selected taxonomy paths.

## How it works

- Reads the taxonomy sheet's **authored source** (not the published site) so
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
  editing tags a page already has (EW plugins can only read/write the
  current selection, not the document generally). **Reset** clears the
  picker back to its initial state.

## Taxonomy location

By default the plugin fetches `taxonomy.json` from the current site's authored
source root (`/source/{org}/{site}/taxonomy.json`). A site can point it
elsewhere with a `taxonomy` query param on the plugin URL, set in the
`path` column of the EW config library row (see **Registration** below):

- A path within the site's own authored source, e.g.
  `/tools/plugins/tags/tags.html?taxonomy=/config/taxonomy.json`
- A full source API URL, to share one taxonomy sheet across multiple
  sites/orgs, e.g.
  `/tools/plugins/tags/tags.html?taxonomy=https://admin.da.live/source/{org}/{site}/taxonomy.json`

## Registration

EW discovers the plugin via a row in the site's config `library` tab, not a file in this repo.

### Installation

1. Go to `https://da.live/config#/{org}/{site}/`.
2. Open the site configuration, then open or create the `library` tab.
3. Verify the `experience` value before adding the row below: the existing example marks `dialog` as uncertain. The hosted URLs also use the `tags` branch; confirm that this is the deployment you intend to use.

| title  | path                                                                                                    | icon                                                                                                    | experience |
| ------ | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------- |
| `Tags` | `https://tags--aem-apps--adobe-rnd.aem.live/tools/plugins/tags/tags.html`                                | `https://tags--aem-apps--adobe-rnd.aem.live/tools/plugins/tags/classification.svg`                         | `dialog`?  |

Append `?taxonomy=...` to the `path` for sites that keep `taxonomy.json`
somewhere other than the default location (see **Taxonomy location**
above).

4. Save the config. Reload the EW canvas editor, then open the side panel dropdown and select the newly added plugin by its configured title.

## Dependencies

Resolving the taxonomy location, fetching the sheet, and parsing its rows
are shared with the [Tags app](../../apps/tags/README.md) via
`tools/apps/tags/taxonomy.js` — one canonical implementation of the
`taxonomy.json` contract for both.

## Troubleshooting

- **Plugin missing from the side panel dropdown:** Check that the site's `library` tab contains the registration row with the configured title. Save the config and reload the EW canvas editor.
- **Plugin does not open:** Check that `path` is the full `.html` URL shown above, keeping any `taxonomy` query parameter, and verify the `experience` value. The example marks `dialog` as uncertain; do not copy the question mark as a configuration value. Check that the URL uses the intended deployment branch.
- **Tags do not appear:** Check that the taxonomy sheet exists at the configured location and that you can read it.
