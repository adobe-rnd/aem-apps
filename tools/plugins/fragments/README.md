# Fragment Picker

A plugin for browsing, previewing, and inserting fragment links into your documents in Experience Workspace (EW). Provides a split-pane interface with a searchable folder tree on the left and live preview on the right.

## Installation

Add this row to the site's `library` tab (see [Registering a plugin](../README.md#registering-a-plugin)):

| title             | path                                        | experience        |
| ----------------- | ------------------------------------------- | ----------------- |
| `Fragment Picker` | `https://main--aem-apps--adobe-rnd.aem.page/tools/plugins/fragments/fragments.html`   | `fullsize-dialog` |

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
- [Tree Utility](https://da.live/nx/public/utils/tree.js) — fragment crawling on sites that aren't on Helix 6
- [nx2 Spectrum Styles](https://da.live/nx2/styles/styles.css) — design system
- No build step; plain ES modules

## Fragment Location

The plugin looks for `fragments` folders at three levels: `/fragments`, `/{folder}/fragments` and `/{folder}/{subfolder}/fragments` (for example `/en/fragments` or `/us/en/fragments`), skipping `drafts` folders. Each folder it finds is a separate section in the tree, and all `.html` documents in it and its subfolders can be inserted. If it finds none, it uses `/fragments`.

On Helix 6 sites the plugin lists content from the source bus (`api.aem.live`) instead of `admin.da.live`.

## Troubleshooting

- **Plugin does not open:** Check that `path` is the full `.html` URL shown above and `experience` is `fullsize-dialog`.
