# Multi-site Manager (MSM) Plugin

A Prepare-menu plugin for managing multi-site links from the page editor in Experience Workspace (EW).
Lets authors publish, sync, detach, and reconnect between a source site and the
sites that link to it without leaving EW.

This plugin is a standalone fork of the `Multi-site Manager` Prepare action on
da-live's [`msm` branch](https://github.com/adobe/da-live/tree/msm/blocks/edit/da-prepare/actions/msm).
da.live doesn't ship that action, so sites add this plugin to their `prepare`
sheet as described below.

## How it works

1. Authors open a page in EW, click the Prepare menu, and pick **Multi-site Manager**.
2. The plugin reads the org's `msm` config sheet to determine the page's role:
   - **As a source** — lists the sites that link to this one.
   - **As a linked site** — shows the source chain up to the root source.
   - **Dual role** — both, shown as separate **Source** and **Linked sites** sections.
3. The author picks an action (publish to preview/live, detach, sync, reconnect,
   etc.) and the plugin executes it via the EW admin API (`admin.da.live`) and the AEM Admin API.

The plugin uses [`DA_SDK`](https://da.live/nx/utils/sdk.js) so all admin calls
are authenticated against the host page's signed-in user — no separate auth
is required.

## Configuration

### 1. `.da/config.json` — `msm` sheet

The plugin reads the org-level `msm` sheet to discover the source/linked
relationships. Columns may use either the original `base`/`satellite` names or
the new `source`/`linked` names — readers accept whichever is present. Each row
describes one site:

| source | linked      | title           |
| ------ | ----------- | --------------- |
| mccs   |             | MCCS Global     |
| mccs   | san-diego   | San Diego       |
| mccs   | pendleton   | Camp Pendleton  |

- A row with `source` set and `linked` empty defines the **source label** for
  that site (used in the breadcrumb).
- A row with both `source` and `linked` defines a link edge: the linked site
  resolves the source's content unless it holds a detached copy.
- Multi-level links work: a `linked` row can also appear as a `source` row
  pointing to deeper linked sites.

### 2. `.da/config.json` — `prepare` sheet

To make the plugin appear in the Prepare menu, add a row to the `prepare`
tab of the org or site config (see
[Registering a plugin](../README.md#registering-a-plugin)). Either point at
this repo's hosted plugin (no code copy needed) or use a relative path if
you've vendored the plugin into your own repo:

**Option A: use the hosted plugin (recommended)**

| title              | path                                                                                    | icon                                                                  | experience |
| ------------------ | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ---------- |
| Multi-site Manager | `https://main--aem-apps--adobe-rnd.aem.live/tools/plugins/msm/msm.html`              | `https://da.live/blocks/edit/img/S2_Icon_GlobeGrid_20_N.svg#S2_Icon_GlobeGrid` | dialog     |

**Option B: vendored copy in your repo**

| title              | path                              | icon                                                                  | experience |
| ------------------ | --------------------------------- | --------------------------------------------------------------------- | ---------- |
| Multi-site Manager | `/tools/plugins/msm/msm.html`     | `https://da.live/blocks/edit/img/S2_Icon_GlobeGrid_20_N.svg#S2_Icon_GlobeGrid` | dialog     |

## Behavior matrix

| Page role     | Direction available  | Actions                                            |
| ------------- | -------------------- | -------------------------------------------------- |
| Source only   | Linked sites (down)  | Publish · Preview · Detach · Sync (Merge/Replace) · Reconnect |
| Linked only   | Source (up)          | Get from source · Sync (Merge/Replace) |
| Both          | Source + Linked sites sections | Both sets                                |

### Sync modes

When syncing content from a source into a linked site (or pulling into the
current site from its source), two modes are available:

- **Merge** — runs a 3-way merge that preserves local edits in the linked site
  while pulling in changes from the source. Backed by the
  `mergeCopy` function from [`nx/blocks/loc/project`](https://da.live/nx/blocks/loc/project/index.js),
  loaded dynamically at runtime.
- **Replace** — replaces the linked site's content with the source's content.
  Local edits are lost.

### Cascade to nested sites

For recursive actions (Publish / Preview) on sites that have nested
descendants, the publish confirm shows scope chips for the whole subtree, so
the action can run against every linked site below the selected one, not just
the direct child.

## Relationship to the da-live version

This plugin began as a **fork-copy** of `blocks/edit/da-prepare/actions/msm/` on
da-live's `msm` branch and has since diverged (rewritten UI/logic over a shared `core/`). The
dependency wiring also differs:

| Concern            | da-live (`msm` branch)                          | Plugin (this repo)                                                 |
| ------------------ | ----------------------------------------------- | ------------------------------------------------------------------ |
| Lit                | `da-lit` resolved internally                    | `da-lit` resolved via importmap → `/tools/deps/lit/dist/index.js`  |
| `daFetch`          | `blocks/shared/utils.js`                        | `DA_SDK.actions.daFetch`, plumbed in via `setSdkFetch`             |
| `DA_ORIGIN`        | `blocks/shared/constants.js`                    | `admin.da.live`, defined in the shared `core/fetch.js`             |
| NX URL             | `getNx()` (versioned/branch-aware)              | Hardcoded `https://da.live/nx`                                     |
| `mergeCopy`        | Dynamic import via `getNx()`                    | Dynamic import via the hardcoded NX URL                            |
| UI primitives      | `se-*` components from `${nx}/public/se/components.js`   | Own plain `<button>` elements styled in `msm.css` (no `se-*`/`sl-*` component lib); base typography via nexter (`loadStyle` / `getStyle`) |
| Icons              | Relative paths `/blocks/edit/img/...`           | Shared `core/icons.js` — inline `<svg><use>` from SVGs in `core/img/` |
| Edit-link origin   | `window.location.origin` (always da.live)       | Derived from `document.referrer`; falls back to `https://da.live`  |

## Files

```
tools/plugins/msm/
├── README.md   (this file)
├── msm.html    (iframe entry; loads da-lit via importmap and msm.js)
├── msm.js      (<da-msm> Lit component + self-init from DA_SDK)
├── msm.css     (component styles, adapted to fill the 400x400 iframe)
├── config.js   (re-exports core config: source/linked resolution)
└── utils.js    (re-exports core operations: preview/publish/copy/delete/merge)
```

## Troubleshooting

- **Plugin does not open:** Check that `path` is the full hosted `.html` URL shown above, or the correct site-relative `.html` path for a vendored copy, and `experience` is `dialog`.
- **Source or linked sites are missing:** Check the org-level `msm` sheet and its source/linked relationships as described above.
- **An action fails:** Check the displayed error, your sign-in session, and access to the affected sites through the EW admin API and the AEM Admin API.
