# Fragment Picker

A plugin for browsing, previewing, and inserting fragment links into your documents in Experience Workspace (EW). Provides a split-pane interface with a searchable folder tree on the left and live preview on the right.

## Prerequisites

The site needs a `library` tab in its EW site config at `https://da.live/config#/{org}/{site}/`. Follow [Set up library](https://www.aem.live/docs/ew/administering/set-up-library#update-project-config-sheet) first. This guide assumes that setup is complete; the plugin only appears in EW when the library is configured and contains its registration row.

## Installation

1. Go to `https://da.live/config#/{org}/{site}/`, replacing `{org}` and `{site}` with your org and site values.
2. Open the site configuration, then open or create the `library` tab.
3. Add the following row, preserving any existing library entries:

| title             | path                                        | experience        |
| ----------------- | ------------------------------------------- | ----------------- |
| `Fragment Picker` | `https://main--aem-apps--adobe-rnd.aem.page/tools/plugins/fragments/fragments.html`   | `fullsize-dialog` |

4. Save the config. Reload the EW canvas editor, then open the side panel dropdown and select the newly added plugin by its configured title.

The `title` value is the name shown in the side panel dropdown.

## How to Use

1. Open a page in your site using the EW canvas editor and switch to **Content** view.
2. Place the cursor where you want the fragment link inserted.
3. Open the right-hand tools panel if it is collapsed.
4. Open the dropdown at the top of the panel, which may currently show **Outline**.
5. Select **Fragment Picker** (or the title configured for your site) under **Extensions**.
6. **Browse** the fragment tree or **search** by fragment name.
7. Click a fragment to see its live preview.
8. Click **Insert** to add the fragment link to your document.

## Output

```html
<a href="https://main--{repo}--{org}.aem.page/fragments/fragment-name" class="fragment">https://main--{repo}--{org}.aem.page/fragments/fragment-name</a>
```

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

- **Plugin missing from the side panel dropdown:** Check that the site's `library` tab contains the registration row with the configured title. Make sure you are editing a page in the same site where the plugin was configured, and look under **Extensions** in the dropdown. Save the config and reload the EW canvas editor.
- **Plugin does not open:** Check that `path` is the full `.html` URL shown above and `experience` is `fullsize-dialog`.
