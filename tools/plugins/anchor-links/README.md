# Anchor Links Plugin

A DA sidekick plugin for generating anchor links to headings on your page. Useful for building tables of contents, FAQ navigation, and quick-reference sections.

## How to Use

1. **Preview your page** in Franklin so headings get their generated IDs.
2. Open the plugin and click **Scan Page Headings**.
3. Check the headings you want to link to (optionally edit each link title).
4. Click **Create Anchor Links** — the plugin inserts the HTML and closes.

## Output

```html
<p><a href="https://main--{repo}--{org}.aem.page/path#heading-id" title="Section Title">Section Title</a></p>
```

## Configuration

Register in your DA site config:

| title         | path                                           | format   |
| ------------- | ---------------------------------------------- | -------- |
| `Anchor Links`  | `/tools/plugins/anchor-links/anchor-links.html`    | `dialog` |

## Files

| File                   | Purpose                          |
| ---------------------- | -------------------------------- |
| `anchor-links.html`      | Minimal HTML shell               |
| `anchor-links.js`        | Plugin logic                     |
| `anchor-links.css`       | Spectrum-branded styles          |

## Dependencies

- [DA App SDK](https://da.live/nx/utils/sdk.js) — context and document actions
- No build step; plain ES modules
