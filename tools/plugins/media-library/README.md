# Media Library Plugin

A plugin for browsing and inserting media from your site's media library index into documents in Experience Workspace (EW). Provides a full-featured media browsing interface with search, filtering, and preview capabilities.

## Prerequisites

The site needs a `library` tab in its EW site config at `https://da.live/config#/{org}/{site}/`. Follow [Set up library](https://www.aem.live/docs/ew/administering/set-up-library#update-project-config-sheet) first. This guide assumes that setup is complete; the plugin only appears when its library registration is configured.

## How to Use

1. Open a page in EW and switch to **Content** view.
2. Place the cursor where you want to insert the media.
3. Open the plugin from the side panel dropdown and select **Media Library** (or its configured title).
4. **Browse** or **search** for media items (images, videos, documents, fragments, icons).
5. Click a media item to see details and usage information.
6. Click **Insert** to add the media to your document.

## Output

The plugin inserts media references appropriate to the selected item type (image URLs, fragment links, etc.).

## Installation

1. Go to `https://da.live/config#/{org}/{site}/`.
2. Open the site configuration, then open or create the `library` tab.
3. Add the following row:

| title            | path                                                                                              | experience        |
| ---------------- | ------------------------------------------------------------------------------------------------- | ----------------- |
| `Media Library`  | `https://main--aem-apps--adobe-rnd.aem.live/tools/plugins/media-library/media-library.html` | `fullsize-dialog` |

4. Save the config. Reload the EW canvas editor, then open the side panel dropdown and select the newly added plugin by its configured title.

**Important:** Always use `.aem.live` URLs for plugin registration, NOT `.aem.page`. The `.aem.page` domain will cause the plugin to use stage environment instead of production, resulting in authentication errors.

## Features

- **Full media browsing** powered by the media library app
- **Search and filtering** by media type (images, videos, documents, fragments, icons)
- **Folder navigation** and document-based filtering
- **Media details** including dimensions, file size, and usage information
- **Live preview** of media items
- **Responsive design** with dark mode support

## Files

| File                  | Purpose                                    |
| --------------------- | ------------------------------------------ |
| `media-library.html`  | Plugin shell that loads the media library app |
| `media-library.css`   | Shell layout styles with dark mode support |

## Dependencies

- [App SDK](https://da.live/nx/utils/sdk.js) — context and document actions
- [Media Library App](https://da.live/nx/blocks/media-library/media-library.js) — full media browsing interface
- The media library app internally uses nx2 APIs (`source.list`, `daFetch`)
- No build step; plain ES modules

## Media Library Index

The plugin reads your site's media index from the `/.da/media-insights/` folder (`index-meta.json` and the index files next to it). The media library app builds the index the first time it opens a site. Content created before February 2026 needs a bulk index from Adobe; see [Media Library](https://www.aem.live/docs/ew/administering/media-library).

## Troubleshooting

- **Plugin missing from the side panel dropdown:** Check that the site's `library` tab contains the registration row with the configured title. Save the config and reload the EW canvas editor.
- **Plugin does not open:** Check that `path` is the full `.html` URL shown above and `experience` is `fullsize-dialog`.
- **Authentication errors:** Use the `.aem.live` registration URL, not `.aem.page`, as noted above.
- **Media items do not appear:** Check that the site's `/.da/media-insights/` folder has the index files and that you can write to it.
