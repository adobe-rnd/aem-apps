# Fragment Picker Plugin

A DA/EW plugin for browsing and inserting fragments into your documents. Provides a split-pane interface with a searchable folder tree on the left and live preview on the right.

## How to Use

1. Open the plugin from the DA library.
2. **Browse** the fragment tree or **search** by fragment name.
3. Click a fragment to see its live preview.
4. Click **Insert** to add the fragment link to your document.

## Output

```html
<a href="https://main--{repo}--{org}.aem.page/fragments/fragment-name" class="fragment">https://main--{repo}--{org}.aem.page/fragments/fragment-name</a>
```

## Configuration

Register in your DA site config library sheet:

| title             | path                                        | experience        |
| ----------------- | ------------------------------------------- | ----------------- |
| `Fragment Picker` | `https://main--aem-apps--adobe-rnd.aem.page/tools/plugins/fragments/fragments.html`   | `fullsize-dialog` |

## Features

- **Folder tree navigation** with expand/collapse
- **Search filtering** by fragment name
- **Live preview** of selected fragments
- **Insert Fragment Links** matching DA interface
- **Keyboard navigation** (Arrow keys, Enter)
- **Responsive design** with nx2 Spectrum styling

## Files

| File              | Purpose                                    |
| ----------------- | ------------------------------------------ |
| `fragments.html`  | Plugin shell with split-pane layout        |
| `fragments.js`    | Fragment browsing and insertion logic      |
| `fragments.css`   | nx2 Spectrum-branded styles with dark mode |
| `img/*.svg`       | Adobe Spectrum icons (folder, file)        |

## Dependencies

- [DA App SDK](https://da.live/nx/utils/sdk.js) — context and document actions
- [DA Tree Utility](https://da.live/nx/public/utils/tree.js) — fragment crawling
- [nx2 Spectrum Styles](https://da.live/nx2/styles/styles.css) — design system
- No build step; plain ES modules

## Fragment Location

By default, the plugin looks for fragments in `/fragments` within your repository. All `document` files in this folder and its subfolders will be available for insertion.
