# Anchor Links Plugin

A plugin for Experience Workspace (EW) for generating anchor links to headings on your page. Useful for building tables of contents, FAQ navigation, and quick-reference sections.

## Prerequisites

The site needs a `library` tab in its EW site config at `https://da.live/config#/{org}/{site}/`. Follow [Set up library](https://www.aem.live/docs/ew/administering/set-up-library#update-project-config-sheet) first. This guide assumes that setup is complete; the plugin only appears in EW when the library is configured and contains its registration row.

## How to Use

1. Open a page in EW, switch to **Content** view, and place the cursor where you want to insert the links.
2. Open the plugin from the side panel dropdown by its configured title (for example, **Anchor Links**).
3. Click **Scan Page Headings**.
4. Check the headings you want to link to (optionally edit each link title).
5. Click **Create Anchor Links** — the plugin inserts the HTML and closes.

## Output

```html
<p><a href="https://main--{repo}--{org}.aem.page/path#heading-id" title="Section Title">Section Title</a></p>
```

## Configuration

Register in your EW site config's `library` tab:

| title         | path                                           | experience |
| ------------- | ---------------------------------------------- | ---------- |
| `Anchor Links`  | `https://main--aem-apps--adobe-rnd.aem.page/tools/plugins/anchor-links/anchor-links.html`    | `dialog` |

The `experience` column controls how the plugin opens. We recommend `dialog` for this plugin. For library setup, see [Set up library](https://www.aem.live/docs/ew/administering/set-up-library#update-project-config-sheet) at `https://da.live/config#/{org}/{site}/`.

Save the config. Reload the EW canvas editor, then open the side panel dropdown and select the newly added plugin by its configured title.

## Files

| File                   | Purpose                          |
| ---------------------- | -------------------------------- |
| `anchor-links.html`      | Minimal HTML shell               |
| `anchor-links.js`        | Plugin logic                     |
| `anchor-links.css`       | Spectrum-branded styles          |

## Dependencies

- [App SDK](https://da.live/nx/utils/sdk.js) — context and document actions
- No build step; plain ES modules

## Troubleshooting

- **Plugin missing from the side panel dropdown:** Check that the site's `library` tab contains the registration row with the configured title. Save the config and reload the EW canvas editor.
- **Plugin does not open:** Check that `path` is the full `.html` URL shown above and `experience` is `dialog`.
