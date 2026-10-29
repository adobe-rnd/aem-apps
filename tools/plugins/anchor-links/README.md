# Anchor Links Plugin

A plugin for Experience Workspace (EW) for generating anchor links to headings on your page. Useful for building tables of contents, FAQ navigation, and quick-reference sections.

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

Add this row to the site's `library` tab (see [Registering a plugin](../README.md#registering-a-plugin)):

| title         | path                                           | experience |
| ------------- | ---------------------------------------------- | ---------- |
| `Anchor Links`  | `https://main--aem-apps--adobe-rnd.aem.page/tools/plugins/anchor-links/anchor-links.html`    | `dialog` |

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

- **Plugin does not open:** Check that `path` is the full `.html` URL shown above and `experience` is `dialog`.
