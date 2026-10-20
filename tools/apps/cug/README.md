# Closed User Groups

Open the app through DA to use your authenticated session:

```text
https://da.live/app/adobe-rnd/aem-apps/tools/apps/cug/cug?ref=cug#/jckautzmann/jck-ew1
```

Use `ref=local` with the local AEM development server to test uncommitted code.
The URL hash prefills the editable **Org/site** field.
Press **Enter** in that field or click **Get CUG** to load the rules.
Initially, everything below **Get CUG** is hidden and the table has no sample
rows. After a successful load, the table and **Apply CUG** appear.
**Check CUG for a path** appears only when the loaded sheet contains rules.

**Get CUG** first checks the organization's site list. If the org/site is not
found, it displays a message and hides the table, **Apply CUG**, and
**Check CUG for a path** until a valid site is loaded.
Access failures are reported separately.

It then reads the selected site's `/.da/cug/cug.json` spreadsheet through
DA's authenticated source API. Each spreadsheet row becomes exactly one table
row, in source order. An additional empty entry row stays at the bottom. Editing
its path, adding required authentication, or committing a group creates another
empty entry row. Empty or missing spreadsheets show **No CUG rules found**
and only the entry row. Loading failures clear stale rules and display an error;
permission errors are not treated as missing sheets.
Reads bypass the browser cache so spreadsheet changes are reflected on each load.
Nonempty rows missing the `Authentication` column display an explicit header error.

Columns are `Path`, `Authentication`, and `Groups`. Authentication `true` displays **Required**;
`false` or an empty cell displays the add control. Comma-separated groups become
individual chips.
Click the Authentication **+** control to require authentication. Click the
**Required** chip's remove control to return to **+**. These changes stay local
until **Apply CUG** is clicked.
In **Groups**, click **+** to open a field for one group. Press **Enter** or
leave the field to add it as a chip; **Escape** cancels. Empty entries are
discarded and commas are rejected. Click a chip's **x** to remove it.
Group changes are also saved by **Apply CUG**.

**Apply CUG** saves the current browser table to the loaded site's source sheet.
After a successful save, it generates CUG headers from the saved spreadsheet
values using the same shared workflow as the Page Access plugin. `Path` maps
to the header scope, `Authentication` to `x-aem-cug-required`, and `Groups` to
`x-aem-cug-groups`. Unrelated headers are preserved; old CUG headers (including
login-path headers) are replaced. Empty CUG rules remove previous restrictions.
The merged headers are applied directly to the site's Config Service.
**Apply CUG** is disabled (light blue) while the table matches its last loaded
or saved state. Table changes enable it; reverting all changes or successfully
saving disables it again. **Check CUG** is disabled when its Path field is blank
or whitespace-only, independently of unsaved table changes. Both actions are
disabled while loading/saving or when the loaded org/site no longer matches.
Load the site first; changing **Org/site** requires another load before saving.
Rows are saved in their displayed order, excluding the untouched entry row. Required
authentication is written as `"true"`; the add-control state is written as `""`.
Groups are joined with commas. Spreadsheet metadata such as column widths is
preserved. Saving failures leave table edits intact for retry. Saving does not
preview or publish the sheet.
If the sheet saves but header application fails, the app reports the partial
success and keeps **Apply CUG** enabled for retry, even without further edits.
If the source sheet does not exist (HTTP 404), **Apply CUG** creates it.

Drag a row's handle to reorder rules; the insertion line marks the drop position.
Alternatively, focus the handle and use **Up/Down** arrow keys.
Click the handle to open **Insert row above / Insert row below**. Choosing an
option creates an editable row and focuses its Path field. The menu supports
arrow-key navigation and **Escape** to close.
Click a row's delete icon to remove it. Reordering and deletion stay local until
**Apply CUG** saves the table.
The trailing entry row cannot be moved or deleted.

The **Check CUG** result card is hidden until **Check CUG** is clicked and resets
when loading a site's rules. Its displayed results are still mockup values.
