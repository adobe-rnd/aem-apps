# Workfront in Experience Workspace

This is an **❗ Early Access ❗** Experience Workspace author plugin to access Workfront. It showcases a how an integration could look like. For concrete use cases the UI might need to be adjusted.

## Add to Experience Workspace

To make this plugin available in the EW editor side panel, add an entry in the site's **library** sheet (`https://da.live/config#/<org>/<site>/`):

| title | path | ... |
| --- | --- | --- |
| Workfront | https://main--aem-apps--adobe-rnd.aem.live/tools/apps/workfront/workfront.html | ... leave empty ... |

and add the following keys to the `data` sheet:

| key | value |
| --- | --- |
| `workfront.origin` | `https://your-tenant.my.workfront.com` |
| `workfront.origin.proxy` | Optional HTTPS proxy URL: an origin, or a base URL with a path such as an Adobe I/O Runtime action URL. Leave blank or omit for direct requests |

The plugin connects through the official [EW/DA SDK](https://da.live/nx/utils/sdk.js).

**Note** to access Workfront APIs currently a CORS proxy is needed. API calls go to `<proxy URL>/attask/api/...`; links to Workfront records keep using `workfront.origin`. Two sample implementations are available:

- [cors](./cors/README.md): a Cloudflare Worker.
- [adobeio](./adobeio/README.md): an Adobe App Builder (I/O Runtime) web action, for organizations entitled to App Builder.

## Find items and users

The compact toolbar keeps **New task** beside search and **Refresh** beside the
connection status. Refresh is hidden while connecting. Page context still comes
from EW for filtering, linking, and creating tasks, without repeating it in a header.

**Assigned to me** is the first context filter; **This page** remains the default
context. **Tasks** is the default tab, with **Projects** beside it. Both use the
same accordion layout and start with no item open. Click a row, or focus it and
press Enter or Space, to open its details directly beneath it. Opening another
row closes the previous one; clicking the open row closes it. Switching tabs,
changing context, or refreshing collapses the rows. Creating a task opens its
new row, and a task's parent-project link opens that project's row in Projects.
Item counts appear only in the tabs.

Search filters project and task names in the selected context. Typing a user's
name also suggests up to eight matching users. Select a suggestion with the mouse
or Arrow keys and Enter to show that user's assignments and project teams.
Continue typing to narrow their items by name. Remove the user chip to return to
the previous context, or select a context filter. Escape closes suggestions;
press it again to clear the text.

## Contribution

Node 18 or later, from the repository root:

```sh
node --test test/tools/apps/workfront/*.test.js
```

Or run `npm test` inside this directory. The repository-root `npm test` also
includes these tests. No `npm install` is needed.

### Scrolling regression check

Open the plugin in an EW side panel and select **All** with enough items to
extend below the viewport. Verify that mouse-wheel or trackpad scrolling over
the list reaches the last item, then returns to the top. Repeat in Tasks and
Projects with a row expanded, at narrow and wide panel widths. Confirm that
details appear between the expanded row and the next row, not after the list.
The app body must remain in normal document flow so the iframe document can scroll.
