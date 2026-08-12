# Tags plugin

A multi-select, searchable tag picker for authors, backed by a site's tag
taxonomy sheet (`/taxonomy.json` by default).

Ported from
[scdemos/demo's `tools/plugins/tags`](https://github.com/scdemos/demo/tree/main/tools/plugins/tags),
adapted for a flat `Namespace`/`Category`/`Tag`/`Description` taxonomy
sheet (fetched from the DA source API rather than a `docs/library/*.json`
file), and generalized to work across orgs/sites and to let each site
configure where its taxonomy sheet lives.

## How it works

- **Editing tags on a page that already has some**: DA plugins can only
  insert/replace at the document's current text selection
  (`actions.sendText`/`sendHTML`) and read that selection back
  (`actions.getSelection`) — there's no API to read or modify the document
  more generally. To edit existing tags, an author should select the
  current `Tags` value in the Metadata block, open this plugin, and click
  **Read Selection** to pre-populate the picker from whatever taxonomy
  paths are in that selection. Matching is substring-based
  (`text.includes(tag.path)`), not an exact split on commas — the editor's
  selection text isn't guaranteed to come back as a clean comma list (the
  first/last entries can pick up stray characters at the boundary), so
  scanning for each known path directly is more robust than trusting a
  split. There's no push notification if the selection changes while the
  panel is already open (the SDK only exposes a pull, request/response
  `getSelection`), so **Read Selection** can be clicked again any time to
  catch the picker up to a new selection. **Send Selected** then relies on
  that same selection still being active in the document to replace it,
  rather than just inserting alongside the old value — worth confirming
  empirically once this is wired up in a real DA doc.
- Fetches the taxonomy sheet's **DA source** (unpublished/authored version,
  via `actions.daFetch`) — not the published site — so authors see
  taxonomy edits immediately without needing to publish first. The org and
  repo come from the DA SDK's `context`, so the same plugin code works for
  any org/site; only the taxonomy sheet's location may need configuring
  per site (see **Taxonomy location** below).
- Groups tags under a collapsible heading per `Namespace`, expanded by
  default. Clicking a namespace heading collapses/expands just that
  section — a manual, per-author UI choice. An active search always
  force-expands any namespace with a match, regardless of its collapsed
  state, so a search never hides results behind a collapsed section.
- `Category`, when present, shows as a small pill badge next to the tag
  name (e.g. "Other Series" next to a tag under "Race Series") —
  deliberately distinct from the tag name so the two don't read as
  identical secondary text. Nested categories are just a `/`-separated
  `Category` cell in the sheet (e.g. `catlev1/catlev2`) — no special
  handling needed, since it's carried through into the tag's path as an
  opaque string.
- A tag's `Description`, when present, is available via a small "ⓘ" button
  that opens a click-to-toggle popover (Popover API + CSS anchor
  positioning — both recent-baseline, judged an acceptable tradeoff here
  since this is an authoring tool, not the served site) rather than a
  hover-only `title` tooltip, which never shows on touch and would leave
  the button looking broken on click. Still searchable regardless of
  whether the popover's open.
- Multi-select via checkboxes, with search/filter across tag, namespace,
  category, and description text; a clear (×) button in the search field
  resets it.
- A summary of currently selected tags — each removable via its own × —
  sits right above the action buttons.
- Action buttons: **Send Selected** inserts the selected tags' full
  taxonomy paths (`Namespace:Category/Tag`, or `Namespace/Tag` with no
  category), comma-separated, at the author's cursor via
  `actions.sendText`, and leaves the panel open (keeps imported and
  author-picked tags consistent and distinguishable even when the same
  leaf tag name exists under more than one namespace). **Read Selection**
  loads the picker from the document's current selection (see above).
  **Reset** clears the picker back to its initial state — selection,
  search text, and any collapsed namespaces.

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

## Registration (manual — not a repo file)

DA discovers plugins via a row in the site's DA config sheet (Site
**CONFIG** > **library**), not a file in this repo. Someone with DA admin
access needs to add:

| title  | path                                                                                                    | icon                                                                                                    | experience |
| ------ | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------- |
| `Tags` | `https://tags--aem-apps--adobe-rnd.aem.live/tools/plugins/tags/tags.html`                                | `https://tags--aem-apps--adobe-rnd.aem.live/tools/plugins/tags/classification.svg`                         | `dialog`?  |

Append `?taxonomy=...` to the `path` for sites that keep `taxonomy.json`
somewhere other than the default location (see **Taxonomy location**
above).
