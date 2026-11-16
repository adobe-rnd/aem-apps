# Publish Requests Setup

Self-serve onboarding for request publish, v1 and v2. A site's config admin registers the site with the
[publish-requests-worker](https://github.com/cloudadoption/publish-requests-worker), chooses a version,
and edits the workflow config without opening the config sheets.

```text
https://da.live/app/adobe-rnd/aem-apps/tools/apps/publish-requests-setup/publish-requests-setup?org=my-org&site=my-site
```

`?env=ci` targets the CI worker; localhost uses the local worker on port 8787. Both inboxes and both
plugins link here when a site isn't registered or has no approval rules.

## Sections

| Section | Writes |
|---|---|
| Registration | Worker `POST /api/site-config`: email provider, custom API settings, allowed email domains. Providers come from the worker; Adobe's default provider shows its non-production warning and needs an acknowledgement. |
| Plugin and inbox | `library` and `apps` rows for the chosen version. Switching version replaces the other version's rows and lists them first. Existing rows for the chosen version (pinned refs, vendored copies) are kept. |
| Approval rules | Rules (`publish-workflow-config`), v2 workflows (`publish-workflow-steps`) and distribution lists (`publish-workflow-groups-to-email`), saved together. Lists used in rules but not defined are added for you to fill in. |
| Settings | Known `publish-workflow-settings` keys. Unknown keys, such as guidance item markers, are kept. |

## How saving works

Approval rules and settings go through the worker's `GET`/`POST /api/workflow-config` (v1) or
`/api/v2/workflow-config` (v2). The worker validates them, keeps every other tab, and refuses a save
when the config changed since it was loaded (`409`); the app then reloads and keeps your edits so you
can save again. Validation errors and warnings from the worker show under the section. If the site
follows the org's rules, the app shows that and offers **Use site-specific rules** (`copyFromOrg`).

The plugin and inbox rows aren't covered by that API, so the app writes them directly: it re-reads the
site config (`admin.da.live/config/{org}/{site}/`), replaces only those rows, and writes it back.

The worker's `canEdit` (config write on the site) decides whether the page is editable. Without it,
the page is read-only with a note to ask a config admin.

Authors and approvers also need write access to `/.da/publish-workflow-requests.json`. That's set in
the org's Experience Workspace permissions, which this app doesn't edit.

## Files

| File | Purpose |
|---|---|
| `publish-requests-setup.html` | Entry HTML that loads the DA SDK and the app |
| `publish-requests-setup.js` | Lit component: site picker, sections, editors |
| `publish-requests-setup.css` | S2-token styles |
| `api.js` | Worker registration and workflow-config calls, DA config read/write for plugin and inbox rows, site lookup |
| `model.js` | Pure config logic: version detection, install rows, row mapping for the editors (tests in `test/tools/apps/publish-requests-setup/`) |
