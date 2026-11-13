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
| `workfront.origin.proxy` | Optional HTTPS proxy origin; leave blank or omit for direct requests |

The plugin connects through the official [EW/DA SDK](https://da.live/nx/utils/sdk.js).

**Note** to access Workfront APIs currently a CORS proxy is needed, a sample implementation can be found in the `cors` subfolder.

## Contribution

Node 18 or later, from the repository root:

```sh
node --test tools/apps/workfront/tests/*.test.js
```

Or run `npm test` inside this directory. No `npm install` is needed.
