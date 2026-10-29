# Plugins

Plugins for Experience Workspace (EW). Each plugin's README has the config row to add.

## Registering a plugin

1. Open the site config at `https://da.live/config#/{org}/{site}/`.
2. Open the tab the plugin's README names, or create it:
   - `library`: authors open the plugin from the side panel dropdown in the EW canvas editor, under **Extensions**. The same tab holds the site's blocks, templates and icons rows (see [Set up library](https://www.aem.live/docs/ew/administering/set-up-library#update-project-config-sheet)).
   - `prepare`: authors open the plugin from the Prepare menu. Prepare rows also work in the org config at `https://da.live/config#/{org}/`.
3. Add the plugin's row and save the config.
4. Reload the EW canvas editor. The plugin is listed under the row's `title`.

If the plugin doesn't show up, check that the row is in the right tab and that you're editing a page of that site, then save the config and reload the editor.
