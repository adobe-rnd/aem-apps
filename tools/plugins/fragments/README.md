# Fragment Picker

An Experience Workspace extension for browsing, previewing, and inserting fragment links into your documents. Provides a split-pane interface with a searchable folder tree on the left and live preview on the right.

## Configuration

**One-time setup for site administrators**

The Fragment Picker must be registered in your site's library configuration before it appears in Experience Workspace.

1. Open your site configuration at `https://da.live/config#/{org}/{site}/`, replacing `{org}` and `{site}` with your org and site values.
2. Add a tab named `library` if it does not already exist.
3. Add the following row, preserving any existing library entries.

| title             | path                                        | experience        |
| ----------------- | ------------------------------------------- | ----------------- |
| `Fragment Picker` | `https://main--aem-apps--adobe-rnd.aem.page/tools/plugins/fragments/fragments.html`   | `fullsize-dialog` |

The `title` value determines the name shown in the side panel dropdown. With the configuration above, look for **Fragment Picker**. If your site uses **Fragments** as the title, that is the name you will see instead.

For project configuration instructions, see [Set up library](https://www.aem.live/docs/ew/administering/set-up-library#update-project-config-sheet).

## How to Use

1. Open a page in your site using the **Canvas editor** in **Experience Workspace**.
2. Place the cursor where you want the fragment link inserted.
3. Open the right-hand tools panel if it is collapsed.
4. Open the dropdown at the top of the panel, which may currently show **Outline**.
5. Under **Extensions**, select **Fragment Picker**, or the name configured for your site.
6. **Browse** the fragment tree or **search** by fragment name.
7. Click a fragment to see its live preview.
8. Click **Insert** to add the fragment link to your document.

## Fragment Picker Is Missing

If the dropdown has no **Extensions** section, or the picker is not listed, ask your site administrator to check the [configuration above](#configuration):

- The project configuration contains a `library` tab.
- That tab contains the Fragment Picker row with the documented URL and `fullsize-dialog` experience.
- You are editing a page in the site where the extension was configured.

Reload the editor after updating the configuration.

## Output

```html
<a href="https://main--{repo}--{org}.aem.page/fragments/fragment-name" class="fragment">https://main--{repo}--{org}.aem.page/fragments/fragment-name</a>
```

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
