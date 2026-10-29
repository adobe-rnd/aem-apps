# Fragment Picker Plugin

A plugin for browsing and inserting fragments into your documents in Experience Workspace (EW). Provides a split-pane interface with a searchable folder tree on the left and live preview on the right.

## Prerequisites

The site needs a `library` tab in its EW site config at `https://da.live/config#/{org}/{site}/`. Follow [Set up library](https://www.aem.live/docs/ew/administering/set-up-library#update-project-config-sheet) first. This guide assumes that setup is complete; the plugin only appears in EW when the library is configured and contains its registration row.

## How to Use

1. Open a page in EW and switch to **Content** view.
2. Place the cursor where you want to insert the fragment.
3. Open the plugin from the side panel dropdown and select **Fragment Picker** (or the title configured during installation).
4. **Browse** the fragment tree or **search** by fragment name.
5. Click a fragment to see its live preview.
6. Click **Insert** to add the fragment link to your document.

## Output

```html
<a href="https://main--{repo}--{org}.aem.page/fragments/fragment-name" class="fragment">https://main--{repo}--{org}.aem.page/fragments/fragment-name</a>
```

## Installation

1. Go to `https://da.live/config#/{org}/{site}/`.
2. Open the site configuration, then open or create the `library` tab.
3. Add the following row:

| title             | path                                        | experience        |
| ----------------- | ------------------------------------------- | ----------------- |
| `Fragment Picker` | `https://main--aem-apps--adobe-rnd.aem.page/tools/plugins/fragments/fragments.html`   | `fullsize-dialog` |

4. Save the config. Reload the EW canvas editor, then open the side panel dropdown and select the newly added plugin by its configured title.

## Features

- **Folder tree navigation** with expand/collapse
- **Search filtering** by fragment name
- **Live preview** of selected fragments
- **Insert Fragment Links** matching the EW interface
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

- [App SDK](https://da.live/nx/utils/sdk.js) — context and document actions
- [Tree Utility](https://da.live/nx/public/utils/tree.js) — fragment crawling
- [nx2 Spectrum Styles](https://da.live/nx2/styles/styles.css) — design system
- No build step; plain ES modules

## Fragment Location

By default, the plugin looks for fragments in `/fragments` within your repository. All `document` files in this folder and its subfolders will be available for insertion.

## Troubleshooting

- **Plugin missing from the side panel dropdown:** Check that the site's `library` tab contains the registration row with the configured title. Save the config and reload the EW canvas editor.
- **Plugin does not open:** Check that `path` is the full `.html` URL shown above and `experience` is `fullsize-dialog`.
