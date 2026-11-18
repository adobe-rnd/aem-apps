# Publish Requests Setup

Self-serve onboarding for Request Publish - Single Step (v1) and Request Publish - Multi Step (v2). A
site's config admin registers the site with the
[publish-requests-worker](https://github.com/cloudadoption/publish-requests-worker), chooses a version,
and edits the workflow config without opening the config sheets.

```text
https://da.live/app/adobe-rnd/aem-apps/tools/apps/publish-requests-setup/publish-requests-setup?org=my-org&site=my-site
```

`?env=ci` targets the CI worker, also from local code (`?ref=local&env=ci`); otherwise localhost uses
the local worker on port 8787. The worker's setup routes refuse uppercase org and site names (`400`),
so the app lowercases what you type and the `?org=&site=` values before calling it. Both inboxes and both plugins link here when a site isn't registered or
has no approval rules.

| Version | Internal value | Worker routes |
|---|---|---|
| Request Publish - Single Step | `v1` | `/api/setup`, `/api/workflow-config` |
| Request Publish - Multi Step | `v2` | `/api/v2/setup`, `/api/v2/workflow-config` |

## Sections

| Section | Writes |
|---|---|
| Registration | Worker `POST /api/site-config`: email provider, custom API settings, allowed email domains. Providers come from the worker; Adobe's default provider shows its non-production warning and needs an acknowledgement. Errors for one field are shown on that field. A caller without DA config write gets only the API URL's origin (`apiUrlRedacted: true`): the field shows it as set, isn't prefilled, and the redacted value is never sent back. |
| App Version | Worker `POST /api[/v2]/workflow-config` with `install: true`, on the route of the version being installed: the `library` (Experience Workspace extension) and `apps` (app) rows for that version. Switching version replaces the other version's rows, which are listed first. Existing rows for the chosen version (pinned refs, vendored copies) are kept. When nothing is installed, Single Step is preselected unless the rules use Multi Step workflows. |
| Approval rules | Rules (`publish-workflow-config`), Multi Step workflows (`publish-workflow-steps`) and distribution lists (`publish-workflow-groups-to-email`), saved together, each in its own panel. Lists used in rules but not defined are added for you to fill in. Before saving, approver, CC and list entries are checked inline as the worker checks them: an email address or a defined list name (list names may contain `@`). A Multi Step rule without a workflow (**None (single step)**) has one approval step; when no workflow exists yet, the picker offers **Add a workflow**. A workflow that rules use, even only in the unsaved draft, can't be removed, nor can its last step: the app names those rules instead (names match in any case, as in the worker). Renaming a workflow moves its rules along. Before saving, a rule whose workflow doesn't exist, and a used workflow none of whose steps can approve, are flagged. The Single Step editor shows a Multi Step rule as an error, with a way to convert it. |
| Settings | The `publish-workflow-settings` keys the version reads, linked to its docs. Both versions read `request.comments.required`, `request.comments.length`, `request.support.contact` and `theme.accent-color[-hover]`; Multi Step adds `request.guidance.*`. `approvals.cc.can-approve` shows for Single Step, and for Multi Step only when a rule has no workflow (or it is set). Unknown and hidden keys are kept; guidance item keys such as `request.guidance.item.N.marker` move with their item. |

## How loading and saving work

Loading reads the site and org DA config in parallel (`admin.da.live/config/{org}/{site}/`, read only)
to detect the installed version, then makes one worker call: `GET /api/setup` (Single Step) or
`/api/v2/setup` (Multi Step). It returns the registration, the provider options, `canEdit`, `installed`
and the workflow config view. The worker's `installed` wins over the app's own detection, since a DA
read can be up to a minute old. A `site-not-found` answer means the Edge Delivery Services site
doesn't exist yet, and nothing is offered; `preview-write-required` means the user needs at least the
`basic_author` role. A `503` (including a registration the worker can't read,
`registration-unavailable`) or a network failure is shown as the service not answering, never as
an unregistered site.

Every config write goes through the worker. DA config is eventually consistent and has no conditional
write, so a second writer could undo a recent save. Approval rules, settings and the App Version
install all use `POST /api[/v2]/workflow-config`. The worker validates them, keeps every other tab, and
refuses a save when the tabs changed since they were loaded (`409`). The app then reloads, rebuilds the
editor from the new tabs and re-applies only your changes (by rule pattern, list name, workflow name
and setting key). Where you both changed the same thing, or the changes can't be matched, it shows
theirs and asks before replacing them. Validation errors and warnings from the worker show under the
section, and the save result shows next to the Save button. If the site follows the org's rules, the
app shows that and offers **Use site-specific rules** (`copyFromOrg`).

Every save sends the `version` of the most recent worker response, which changes with each save,
the App Version install included. A workflow read that was started before a save never
replaces the save's view.

Refused saves are shown in plain words: a change too large to send (`413 payload-too-large`), a
site config that would grow over 2 MiB (`413 config-too-large`), a workflow none of whose steps
can be approved (`unstaffed-workflow`), a `library` or `apps` sheet with the same column twice
(`install-sheet-incompatible`), and org rules that can't be read when the site uses or would use
them (`org-config-unreadable`, on an install, a copy or when removing the site's rules). Errors
in the org rules a site would inherit (`field` starting `orgTabs.`) are labelled as the org's
rules. The `single-sheet-inactive` and `org-config-unreadable` warnings show under the rules.

The worker's `canEdit` (config write on the site) decides whether the page is editable. Without it,
the page is read-only with a note to ask a config admin. When the worker reports
`permissionsMode: "open"` (the DA org has no permissions sheet, so anyone can change the site's
config), the app shows a short warning linking to
[DA permissions](https://www.aem.live/docs/ew/administering/permissions); nothing is shown for
`restricted` or `unknown`.

Authors and approvers also need write access to `/.da/publish-workflow-requests.json`. That's set in
the org's Experience Workspace permissions (`https://da.live/config/permissions#/{org}/{site}`, linked
from App Version), which this app doesn't edit.

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
