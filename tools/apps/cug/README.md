# Closed User Groups

The **Documentation** link below the app title opens the
[Closed User Groups documentation](https://www.aem.live/developer/closed-user-groups)
in a new tab and is available before loading a site.

Open the app through DA to use your authenticated session:

```text
https://da.live/app/adobe-rnd/aem-apps/tools/apps/cug/cug?ref=cug#/myOrg/mySite
```

Use `ref=local` with the local AEM development server to test uncommitted code.
The URL hash prefills the editable **org/site or AEM URL** field.
Both `#/org/site` and `#org/site` are accepted and prefill the field as
`org/site`, without a leading slash. Manual input still accepts either
`/org/site` or `org/site`.
You can also paste an HTTPS AEM preview or live page URL, such as
`https://main--site--org.aem.page/path` or
`https://main--site--org.aem.live/path`. The app infers the org/site from the
hostname; the branch, page path, query, and fragment do not affect which rules
are loaded or saved. It reads DA's source sheet, not the pasted page URL.
Press **Enter** in that field or click **Load** to load the rules.
Initially, the table and **Apply** are hidden and the table has no sample rows.
After a successful load, the table and **Apply** appear unless a legacy
spreadsheet is detected.

The app checks for legacy spreadsheets only when **Load** is used, not when the
page opens, even if an org/site is supplied in the URL hash.
If `/.da/cug/cug.json` is missing (HTTP 404) but `/closed-user-groups.json` exists,
the app shows this notice below **Load**:

> **Legacy spreadsheet detected**
>
> This site uses a legacy Closed User Groups spreadsheet. To manage access in this app, migrate your existing rules.

A **Migrate** button appears below the message. The status text, rules table,
and **Apply** remain hidden until migration succeeds.

**Migrate** copies `/closed-user-groups.json` to `/.da/cug/cug.json`, preserving
row order, additional columns other than `cug-login-path`, and spreadsheet
metadata while translating the legacy columns:

| Legacy column | App column |
| --- | --- |
| `url` | `Path` |
| `cug-required` | `Authentication` |
| `cug-groups` | `Groups` |

The `cug-login-path` column is omitted from the destination; it is not migrated.
Rows left with neither Authentication nor Groups, including login-only legacy
rows, fail validation before writing.
Legacy authentication values are normalized to `"true"`, `"false"`, or `""`.
Rows already using the app's columns are retained. Conflicting legacy/app column
pairs, malformed rows, and invalid paths are rejected before a destination is
written.
The original spreadsheet is left untouched. The app checks the destination
again before copying and refuses to overwrite an existing spreadsheet.
After copying, it uses the normal loading logic to display the table.
If copying succeeds but loading fails, the app reports both outcomes and offers
**Load** to retry without copying again.
Migration does not preview, publish, or apply headers. **Apply** is enabled
immediately after migration, even without edits, so you can apply the migrated
rules. Controls are locked while copying, and failures are displayed.

An existing new spreadsheet, even an empty one, suppresses the notice. Changing
the site or starting another load clears stale notices. Access and request
failures are reported, not treated as missing spreadsheets. Detection is read-only;
it does not copy, delete, or migrate either spreadsheet.

**Load** first checks the organization's site list. If the org/site is not
found, it displays a message and hides the table and **Apply** until a valid
site is loaded.
Access failures are reported separately.

It then reads the selected site's `/.da/cug/cug.json` spreadsheet through
DA's authenticated source API. Each spreadsheet row becomes exactly one table
row, in source order. An additional empty entry row stays at the bottom. Editing
its path, selecting Required or Not required, or committing a group creates another
empty entry row. Empty or missing spreadsheets show **No rules found**
and only the entry row, unless the legacy notice is displayed.
Loading failures clear stale rules and display an error;
permission errors are not treated as missing sheets.
Reads bypass the browser cache so spreadsheet changes are reflected on each load.
Nonempty rows missing the `Authentication` column display an explicit header error.

Columns are `Path`, `Authentication`, and `Groups`. Authentication is a dropdown
with three distinct values: **Required** (`true`), **Not required** (`false`),
and a blank option (empty value). Boolean and text values in the
spreadsheet are supported. New rows default to the blank option. Changes stay local
until **Apply** is clicked. Comma-separated groups become individual chips.
The authentication field uses matching borders, spacing, hover, and focus styles.
Browsers supporting customizable selects also show a styled option menu; other
browsers retain their native menu. High-contrast mode uses the native control.
In **Groups**, click **+** to open a field for one group. Press **Enter** or
leave the field to add it as a chip; **Escape** cancels. Empty entries are
discarded and commas are rejected. Click a group name to edit it inline.
**Enter** or leaving the field commits the edit; **Escape** or an empty edit
restores the original name. Commas are rejected while editing as well.
Only clicking a chip's **x** removes it; clicking the chip background leaves it
unchanged. Both the group name and **x** are keyboard-accessible buttons with
group-specific labels.
Group changes are also saved by **Apply**.

**Apply** saves the current browser table to the loaded site's source sheet.
Before saving or applying headers, the app checks that every submitted rule has
a Path starting with `/` (surrounding whitespace is ignored), and either an
Authentication value or at least one nonempty group. **Not required** (`false`)
counts as an Authentication value. Rows with both Authentication and Groups
empty fail validation, including completely blank submitted rows. The untouched
trailing entry row is excluded from saving and validation.
Invalid rules display a bulleted list below **Could not save rules:** with one
error for every malformed row, in table order, without changing the source sheet
or live headers. Table edits remain available for correction and retry.
After a successful save, it generates CUG headers from the saved spreadsheet
values using the same shared workflow as the Page Access plugin. `Path` maps
to the header scope, `Authentication` to `x-aem-cug-required`, and `Groups` to
`x-aem-cug-groups`. Required generates `x-aem-cug-required: true`; Not required
generates `x-aem-cug-required: false`; the blank option omits that header without changing
any groups configured for the row.
Unrelated headers are preserved; old CUG headers (including
login-path headers) are replaced. Deleting all rules removes previous restrictions.
The merged headers are applied directly to the site's Config Service.
**Apply** is disabled (light blue) while the table matches its last loaded
or saved state, unless header application is pending after migration or a failed
apply. Table changes enable it; reverting all changes disables it only when no
header application is pending. Successfully saving and applying headers disables
it again. It is also disabled while loading/saving or when the
loaded org/site no longer matches.
Load the site first; changing **org/site or AEM URL** requires another load before saving.
Rows are saved in their displayed order, excluding the untouched entry row.
Authentication is written as `"true"`, `"false"`, or `""`, matching the dropdown.
Groups are joined with commas. Spreadsheet metadata such as column widths is
preserved. Saving failures leave table edits intact for retry. Saving does not
preview or publish the sheet.
If the sheet saves but header application fails, the app reports the partial
success and keeps **Apply** enabled for retry, even without further edits.
Loading a different org/site while its headers are pending asks for confirmation.
**Cancel** restores the current site input and leaves its rules, error message,
and retry action intact; **OK** proceeds to load the requested site. Equivalent
org/site inputs and AEM URLs for the same site do not prompt and retain the retry
action. This also applies to migrated rules that have not yet been applied.
The warning does not add persistent or per-site retry tracking; resolve pending
updates before switching when possible.
If the source sheet does not exist (HTTP 404), **Apply** creates it.

The table grows naturally up to 60% of the viewport height, then scrolls
vertically. Column headings stay visible while scrolling, and **Apply** stays
outside the scrolling area below the table. On narrow screens, the table also
scrolls horizontally.

Drag a row's handle to reorder rules; the insertion line marks the drop position.
Alternatively, focus the handle and use **Up/Down** arrow keys.
Click the handle to open **Insert row above / Insert row below**. Choosing an
option creates an editable row and focuses its Path field. The menu supports
arrow-key navigation and **Escape** to close.
Click a row's delete icon to remove it. Reordering and deletion stay local until
**Apply** saves the table.
The trailing entry row cannot be moved or deleted.
