# Snapshots Plugin

An Experience Workspace / DA side-panel plugin for managing the snapshots that contain the current page. It reuses the snapshot operations from the [Snapshot admin app](https://da.live/apps/snapshots) through the da-nx public SDK (`https://da.live/nx/public/snapshot/api.js`), so actions and labels match the admin app.

## What it does

- Lists every snapshot that contains the current page, with its review status (`Open`, `Locked`, `Ready`, `Rejected`).
- Per snapshot:
  - **Open on aem.reviews** and, once the snapshot has its own copy of the page, **Edit snapshot content**.
  - Under **Content**: **Sync** (from main content into the snapshot) and **Promote** (snapshot to main content), each asking **Merge** or **Overwrite** like the admin app. Shown only when `snapshot.launch` is enabled in the org/site DA config and on the snapshot. The first sync of a page merges, which becomes a plain copy when the snapshot has no copy of the page yet.
  - **Request review**, **Reject & unlock**, **Approve & publish**. Approving publishes the whole snapshot, not only this page. If the snapshot has a future scheduled publish (and the site is registered with the scheduler), approving confirms the schedule instead.
  - **Remove page** (disabled while the snapshot is locked) and **Manage snapshot**, which opens the admin app filtered to that snapshot.
- **Add this page** to an existing unlocked snapshot, or create a new snapshot containing it. Names follow the admin app rules (lowercase letters, numbers, hyphens).

Title, description, password, scheduling, URL lists and deleting snapshots stay in the admin app.

## How it works

- `snapshots.js` bootstraps the panel. The default export follows the panel `init({ context, token, actions })` contract used by Experience Workspace; loading `snapshots.html` directly uses the DA SDK instead.
- Requests go through `actions.daFetch` (or the nx `daFetch` with the SDK token), which adds the user's IMS token for `admin.hlx.page` and `admin.da.live`.
- `utils.js` holds the pure helpers (path normalization, status, page lookup). The page lookup reads every snapshot manifest of the site, so it makes one request per snapshot.
- `panel.js` is the Lit view. It uses nx2 buttons, form styles and the shared `nx-dialog` and `nx-picker`, and supports light and dark mode.

DA source operations (copy, `.snapshots` lookups) use `admin.da.live`. Sites on the AEM source bus (Helix 6) are not supported yet.

## Configuration

Register in your DA site config:

| title       | path                                                                                 |
| ----------- | ------------------------------------------------------------------------------------- |
| `Snapshots` | `https://main--aem-apps--adobe-rnd.aem.page/tools/plugins/snapshots/snapshots.html` |

## Files

| File             | Purpose |
| ---------------- | ------- |
| `snapshots.html` | Shell for iframe use |
| `snapshots.js`   | Bootstrap and panel `init` export |
| `panel.js`       | Lit component |
| `snapshots.css`  | Panel styles |
| `utils.js`       | Pure helpers |
