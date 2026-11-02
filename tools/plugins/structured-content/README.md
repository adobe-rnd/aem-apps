# Structured Content Picker Plugin

A DA/EW plugin for picking a structured content (SC) document and inserting a
reference to it as a `structured-content` block. Modeled on the
[Fragment Picker](../fragments/README.md) and reusing its content listing
(`../fragments/source.js`), so legacy DA and Helix 6 sites are both supported.

## How to Use

1. Open the plugin from the DA library.
2. **Pick a schema** — the list shows every schema in `/.da/forms/schemas` plus
   any schema found on documents, with document counts.
3. **Filter** and click a document to preview its fields (key/value table read
   from the document source). *Open in editor* opens it in `da.live/form`.
4. Click **Insert** (or double-click) to add the block.

## Output

```html
<table><tbody>
  <tr><td>structured-content</td></tr>
  <tr><td><a href="https://main--{repo}--{org}.aem.page/{path}">…</a></td></tr>
</tbody></table>
```

The site renders it with `blocks/structured-content`, which fetches the JSON
from `https://da-sc.adobeaem.workers.dev/{preview|live}/{org}/{repo}/{path}`
(`preview` on `*.aem.page` / localhost, `live` elsewhere). The block sets
`data-schema` to the document's schema name and imports
`blocks/structured-content/renderers/<schema>.js` when the site provides one
(default export `(block, data, metadata)`); otherwise it renders a generic
`<dl>`. Preview-protected sites get a 401 from the preview endpoint, so the
block only renders there on `*.aem.live` once the document is published.

## Where documents are found

Folders mapped to the structured content editor in the org or site config
(`data` sheet) are crawled:

| key           | value                                          |
| ------------- | ---------------------------------------------- |
| `editor.path` | `/<ORG>/<SITE>/<FOLDER>=https://da.live/form#` |

If no `editor.path` entry targets the current site, the whole site is crawled
(dot-folders and `drafts` are skipped). Every crawled document's source is read
to detect its schema (`x-schema-name` in the `da-form` block), so prefer
configuring `editor.path` on large sites.

## Configuration

Register in your DA site config library sheet:

| title                    | path                                                                                          | experience        |
| ------------------------ | --------------------------------------------------------------------------------------------- | ----------------- |
| `Structured Content`     | `https://main--aem-apps--adobe-rnd.aem.page/tools/plugins/structured-content/structured-content.html` | `fullsize-dialog` |

## Files

| File                       | Purpose                                                    |
| -------------------------- | ---------------------------------------------------------- |
| `structured-content.html`  | Plugin shell (schema select, list, preview)                |
| `structured-content.js`    | SDK wiring, crawl, UI and insertion                        |
| `sc-source.js`             | Pure helpers: config roots, schemas, SC parsing, block HTML |
| `structured-content.css`   | Styles                                                     |

## Open points

- Helix 6 document source URL (`api.aem.live/{org}/sites/{repo}/source{path}.html`)
  is assumed from the listing endpoint; verify on an hlx6 site.
- Verify the inserted `<table>` becomes a block in both EW and nx2 editors.
- Delivery endpoint CORS from the site origin is not verified; protected sites
  need a site token (see the aem.live structured content docs).
