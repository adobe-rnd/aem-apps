# Publish Requests Setup

Self-serve onboarding for Request Publish - Single Step (v1) and Request Publish - Multi Step (v2). A
site's config admin registers the site with the
[publish-requests-worker](https://github.com/cloudadoption/publish-requests-worker), chooses a version,
and edits the workflow config without opening the config sheets.

```text
https://da.live/app/adobe-rnd/aem-apps/tools/apps/publish-requests-setup/publish-requests-setup?org=my-org&site=my-site
```

`?env=ci` targets the CI worker, also from local code (`?ref=local&env=ci`); otherwise localhost uses
the local worker on port 8787. Both inboxes and both plugins link here when a site isn't registered or
has no approval rules.

| Version | Internal value | Worker routes |
|---|---|---|
| Request Publish - Single Step | `v1` | `/api/setup`, `/api/workflow-config` |
| Request Publish - Multi Step | `v2` | `/api/v2/setup`, `/api/v2/workflow-config` |

## Sections

| Section | Writes |
|---|---|
| Registration | Worker `POST /api/site-config`: email provider, custom API settings, allowed email domains. Providers come from the worker; Adobe's default provider shows its non-production warning and needs an acknowledgement. Errors for one field are shown on that field. |
| Plugin and inbox | Worker `POST /api[/v2]/workflow-config` with `install: true`, on the route of the version being installed: the `library` and `apps` rows for that version. Switching version replaces the other version's rows, which are listed first. Existing rows for the chosen version (pinned refs, vendored copies) are kept. When nothing is installed, Single Step is preselected unless the rules use Multi Step workflows. |
| Approval rules | Rules (`publish-workflow-config`), Multi Step workflows (`publish-workflow-steps`) and distribution lists (`publish-workflow-groups-to-email`), saved together. Lists used in rules but not defined are added for you to fill in. The Single Step editor shows a Multi Step rule as an error, with a way to convert it. |
| Settings | Known `publish-workflow-settings` keys. Unknown keys are kept; guidance item keys such as `request.guidance.item.N.marker` move with their item. |

## How loading and saving work

Loading reads the site and org DA config in parallel (`admin.da.live/config/{org}/{site}/`, read only)
to detect the installed version, then makes one worker call: `GET /api/setup` (Single Step) or
`/api/v2/setup` (Multi Step). It returns the registration, the provider options, `canEdit`, `installed`
and the workflow config view. The worker's `installed` wins over the app's own detection, since a DA
read can be up to a minute old. A `site-not-found` answer means the Edge Delivery Services site
doesn't exist yet, and nothing is offered; `preview-write-required` means the user needs at least the
`basic_author` role. A `503` or a network failure is shown as the service not answering.

Every config write goes through the worker. DA config is eventually consistent and has no conditional
write, so a second writer could undo a recent save. Approval rules, settings and the plugin and inbox
install all use `POST /api[/v2]/workflow-config`. The worker validates them, keeps every other tab, and
refuses a save when the tabs changed since they were loaded (`409`). The app then reloads, rebuilds the
editor from the new tabs and re-applies only your changes (by rule pattern, list name, workflow name
and setting key). Where you both changed the same thing, or the changes can't be matched, it shows
theirs and asks before replacing them. Validation errors and warnings from the worker show under the
section, and the save result shows next to the Save button. If the site follows the org's rules, the
app shows that and offers **Use site-specific rules** (`copyFromOrg`).

The worker's `canEdit` (config write on the site) decides whether the page is editable. Without it,
the page is read-only with a note to ask a config admin.

Authors and approvers also need write access to `/.da/publish-workflow-requests.json`. That's set in
the org's Experience Workspace permissions, which this app doesn't edit.

The app follows the color scheme stored for its own origin, else the OS setting: the da.live shell
doesn't pass its theme to apps.

## Files

| File | Purpose |
|---|---|
| `publish-requests-setup.html` | Entry HTML that loads the DA SDK and the app |
| `publish-requests-setup.js` | Lit component: site picker, sections, editors |
| `publish-requests-setup.css` | S2-token styles |
| `api.js` | Worker setup, registration and workflow-config calls; DA config reads |
| `model.js` | Pure config logic: version detection, editor drafts and row mapping, the 409 merge, setup response mapping (tests in `test/tools/apps/publish-requests-setup/`) |
