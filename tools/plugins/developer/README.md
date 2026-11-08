# Developer Plugin

A plugin for Experience Workspace (EW) for switching the code branch used to preview the current page. Lets a developer search and pick a branch from a searchable combobox, and reloads the top-level browser page with `?ref=<branch>` applied.

## How to Use

1. Open a page in EW.
2. Open the plugin from the side panel dropdown by its configured title (for example, **Developer**).
3. Search for and select a code branch, or select **Production (no ref)** to remove the override. The page reloads with the selected code branch.

## How It Works

1. On load, the plugin fetches the list of code branches for the current site from the EDS admin API (`GET https://api.aem.live/{org}/repos/{site}/code/`), using `context.org` / `context.repo` and the IMS token from the App SDK. `context.ref` (the current `?ref=` on the top-level page, as parsed by the EW shell) is preselected if it matches a known branch, otherwise the field shows "Production (no ref)".
2. The branch field is a searchable combobox (`sl-input` + a filtered dropdown list, matching the pattern used in the [Permissions app](../../apps/da-permissions/)) so long branch lists stay usable — typing filters the list, arrow keys/Enter navigate, Escape/blur closes it.
3. Selecting a branch (or the "Production (no ref)" entry) rebuilds the top-level EW editor URL (`/{view}?ref={branch}#/{org}/{repo}{path}`) from the SDK context — the plugin can't read the top-level page's existing query params from inside its cross-origin iframe — and asks the EW shell to navigate there via `actions.setHref()`. Selecting "Production (no ref)" omits the `ref` param entirely.
4. `401` and `404` responses from the admin API (and network failures) are surfaced as an inline status message instead of a silent failure.

## Files

| File            | Purpose                     |
| --------------- | ---------------------------- |
| `developer.html`  | Minimal HTML shell (mounts the `<developer-app>` component) |
| `developer.js`    | LitElement component: branch fetch, combobox UI, navigation |
| `developer.css`   | Spectrum/Super Lite-styled combobox (adopted into the component's shadow root) |
| `api.js`          | Thin client for the EDS admin API branch list |
| `icons.js`        | Inline SVG icon helper (chevron) |
| `img/`            | SVG icon assets |

## Configuration

Add this row to the site's `library` tab (see [Registering a plugin](../README.md#registering-a-plugin)):

| title       | path                                                                                   |
| ----------- | --------------------------------------------------------------------------------------- |
| `Developer` | `https://main--aem-apps--adobe-rnd.aem.page/tools/plugins/developer/developer.html`     |

## Dependencies

- [App SDK](https://da.live/nx/utils/sdk.js) — context, token, and `actions.setHref()`
- [EDS admin API](https://www.aem.live/docs/admin.html) — `GET /{org}/repos/{site}/code/` for the branch list
- No build step; plain ES modules

## Troubleshooting

- **Plugin does not open:** Check that `path` is the full `.html` URL shown above.
- **Branch list does not load:** Check the inline status message, your sign-in session, and access to the site's EDS admin API.
