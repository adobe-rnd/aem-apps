# Developer Plugin

A DA plugin scaffold for switching the code branch used to preview the current page. Lets a developer pick a branch and reloads the top-level browser page with `?ref=<branch>` applied.

## How It Works

1. On load, the plugin fetches the list of code branches for the current site from the EDS admin API (`GET https://api.aem.live/{org}/repos/{site}/code/`), using `context.org` / `context.repo` and the IMS token from the DA SDK. `main` is preselected if present, otherwise the first branch returned.
2. Selecting a branch rebuilds the top-level DA editor URL (`/{view}?ref={branch}#/{org}/{repo}{path}`) from the SDK context — the plugin can't read the top-level page's existing query params from inside its cross-origin iframe — and asks the DA shell to navigate there via `actions.setHref()`.
3. `401` and `404` responses from the admin API (and network failures) are surfaced as an inline status message instead of a silent failure.

## Files

| File            | Purpose                     |
| --------------- | ---------------------------- |
| `developer.html`  | Minimal HTML shell           |
| `developer.js`    | Plugin logic                 |
| `developer.css`   | Spectrum-branded styles      |
| `api.js`          | Thin client for the EDS admin API branch list |

## Configuration

Register in your DA site config:

| title       | path                                                                                   | format   |
| ----------- | --------------------------------------------------------------------------------------- | -------- |
| `Developer` | `https://main--aem-apps--adobe-rnd.aem.page/tools/plugins/developer/developer.html`     | `dialog` |

## Dependencies

- [DA App SDK](https://da.live/nx/utils/sdk.js) — context, token, and `actions.setHref()`
- [EDS admin API](https://www.aem.live/docs/admin.html) — `GET /{org}/repos/{site}/code/` for the branch list
- No build step; plain ES modules
