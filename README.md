# AEM Apps
A collection of Adobe owned apps & plugins for Experience Workspace & Document Authoring.

## Environments
- Preview: https://main--aem-apps--adobe-rnd.aem.page/
- Live: https://main--aem-apps--adobe-rnd.aem.live/

## Apps & Plugins

| App | Path | Entry point | Description | Type |
|-----------|------|-------------|-------------|-------------|
| **DA Permissions** |https://da.live/app/adobe-rnd/aem-apps/tools/apps/da-permissions/da-permissions | `tools/apps/da-permissions` | Manage DA Permissions and configuration access  | App |
| **MSM** |https://da.live/app/adobe-rnd/aem-apps/tools/apps/msm/msm | `tools/apps/msm` `tools/plugins/msm` | Manage multi-site manager for your org/site  | App & Plugin |
| **Request Publish** |https://da.live/app/adobe-rnd/aem-apps/tools/apps/publish-request-inbox | `tools/apps/publish-reqquest-inbox` `tools/plugins/publish-reqquest-inbox` | Manage request publish approvals, etc  | App & Plugin |
| **Anchor Links** |https://main--aem-apps--adobe-rnd--aem.page/tools/plugins/anchor-links/anchor-links.html | `tools/plugins/anchor-links` | Lightweight plugin to create anchor links  | Plugin |

## Developing

- All apps and plugins must work with EW and [nx2](https://github.com/adobe/da-nx/tree/main/nx2).
- When adding a new app or plugin, add it to the table above.
- When adding an app, add it to https://da.live/apps#/adobe-rnd/aem-apps

## Installation

```sh
npm i
```

## Linting

```sh
npm run lint
```

## Local development

1. Create a new repository based on the `aem-boilerplate` template
1. Add the [AEM Code Sync GitHub App](https://github.com/apps/aem-code-sync) to the repository
1. Install the [AEM CLI](https://github.com/adobe/helix-cli): `npm install -g @adobe/aem-cli`
1. Start AEM Proxy: `aem up` (opens your browser at `http://localhost:3000`)
1. Open the `{repo}` directory in your favorite IDE and start coding :)
