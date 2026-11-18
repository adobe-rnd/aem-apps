# Workfront in Experience Workspace

This is an **❗ Early Access ❗** Experience Workspace author plugin to access Workfront. It showcases a how an integration could look like. For concrete use cases the UI might need to be adjusted.

## Add to Experience Workspace

To make this plugin available in the EW editor side panel, add an entry in the site's **library** sheet (`https://da.live/config#/<org>/<site>/`):

| title | path | ... |
| --- | --- | --- |
| Workfront | https://main--aem-apps--adobe-rnd.aem.live/tools/apps/workfront/workfront.html | ... leave empty ... |

and add the following keys to the `data` sheet:

| key | value |
| --- | --- |
| `workfront.origin` | `https://your-tenant.my.workfront.com` |
| `workfront.origin.proxy` | Optional HTTPS proxy URL: an origin, or a base URL with a path such as an Adobe I/O Runtime action URL. Leave blank or omit for direct requests |

The plugin connects through the official [EW/DA SDK](https://da.live/nx/utils/sdk.js).

**Note** to access Workfront APIs currently a CORS proxy is needed. API calls go to `<proxy URL>/attask/api/...`; links to Workfront records keep using `workfront.origin`. Two sample implementations are available:

- [cors](./cors/README.md): a Cloudflare Worker.
- [adobeio](./adobeio/README.md): an Adobe App Builder (I/O Runtime) web action, for organizations entitled to App Builder.

## Demo mode

Append `?demo` to the app URL (or `&demo` if it already has query
parameters), including in the EW library entry, to use sample data instead of
Workfront. The presence of the `demo` parameter enables it regardless of its
value, including `?demo=false`. Remove the parameter to use the normal Workfront
connection.

The status shows **Demo Mode** instead of **Workfront connected**, and write
confirmations explicitly say **demo only**. No Workfront configuration, token,
proxy, or API requests are used. Creating, editing, completing, commenting, and
linking tasks operate only in memory. Refreshing the app resets all demo changes;
there is no automatic demo fallback if a real connection fails.

Inside EW, sample items use the current page context and the existing chat
integration. The app can also be opened directly with `?demo`, using a
sample page context; sending a brief to EW chat still requires the EW host.
Sample records have no external Workfront links.

The sample projects, tasks, statuses, priorities, assignments, relative due dates,
and notes mirror the [reference Workfront app](https://github.com/markszulc/ew-ext-workfront).
Its view-only legal sign-off task also rejects editing and completion. The first
task is additionally linked to the current page so page-context filtering can be demonstrated.

Demo data and operations live in `demo.js`, loaded only by the API connection
boundary when explicitly requested. Rendering, searching, filtering, and task
actions share the same client interface in both modes.

## Find items and users

The compact toolbar keeps **New task** beside search and **Refresh** beside the
connection status. Refresh is hidden while connecting. Page context still comes
from EW for filtering, linking, and creating tasks, without repeating it in a header.

Visible filter pills are ordered **All**, **This site**, **This page**,
**Assigned to me**, **Requested by me**, and **Completed (14 days)**.
On initial load and every refresh, **This page** is selected if it contains
tasks or projects; otherwise **This site** is selected if it contains tasks,
falling back to **All**. Refresh clears search and user, title, and project
filters before applying this default.
**Projects** is the first tab, while **Tasks**
is selected by default. Both use the same bordered accordion cards with a
separate owner/date row and no linked/assigned summary line, and start with no
item open. Click a card, or focus it and
press Enter or Space, to open its details directly beneath it. Opening another
row closes the previous one; clicking the open row closes it. Switching tabs,
changing context, or refreshing collapses the rows. Creating a task opens its
new row, and a task's parent-project link opens that project's row in Projects.
Item counts appear only in the tabs.

Search filters project and task names in the selected context. It also suggests
up to eight matching users and eight project/task titles across all accessible
items, regardless of context or project filter. Select a suggestion with the mouse
or Arrow keys and Enter. A title suggestion switches tabs and opens that exact
item, replacing context and project filters with a removable title chip.
A user suggestion shows that user's assignments and project teams.
Continue typing to narrow their items by name. Remove the user chip to return to
the previous context, or select a context filter. Escape closes suggestions;
press it again to clear the text.

**View project tasks** in a project's details switches to Tasks and adds a
removable project chip, initially showing all accessible tasks in that project.
Choose a context or type a search to narrow them further. Removing the project
chip restores the previous context when still in the project-only view.

## Manage tasks

Task rows show status, progress, high/urgent priority, and overdue dates.
Dates are displayed and edited in UTC, including Workfront's non-ISO timestamps.
**Requested by me** shows tasks you created. **Completed (14 days)** shows
completed tasks assigned to you (including your job roles) updated since midnight
UTC 14 days ago; this is an update-date window, not a completion-date audit.
Both filters also show projects containing matching tasks.
Existing context filters retain their behavior and include completed tasks.

Expand a task to **Edit task**, **Mark complete**, or **Post update**. Editing
sends only changed fields. The status picker supports Not started, In progress,
and Complete; an existing custom status is preserved unless you change it.
Mark complete sets status to Complete and progress to 100%; tasks requiring an
approval workflow may need to be completed in Workfront instead.
Notes remain readable on both tasks and projects; posting is task-only.

New tasks can also have a due date, priority, and optional **Assign to me**.
They still require a project and the current page, saved in the Workfront URL
field rather than appended to the description.

The UI uses Workfront license and task access-level permissions when available;
when absent, Workfront checks permissions on each request. Permission rejections
disable the affected task's edit actions, task comments, or creation in the
selected project until refresh. A project-specific creation denial does not
prevent creating tasks in another project. Workfront remains authoritative for
object-level sharing and approvals.
Comment drafts survive filtering and failed requests. After an unconfirmed task
write, further writes to that task are blocked until you refresh and check
Workfront; failed edit drafts stay in the dialog. Never retry an uncertain create
or comment without checking whether it already succeeded.

### Concurrent changes

The Workfront API has no conditional (compare-and-set) writes, so the app
detects most concurrent changes but cannot rule them out.

- **Edits** send only changed fields, so edits to unrelated fields are not
  overwritten. Before saving, the app rereads the task; if someone else changed
  any field being saved since it was loaded, nothing is written and the dialog
  asks you to refresh.
- **Page linking** rereads the task and refuses to replace a URL that already
  points elsewhere. After writing, it rereads the URL again; if another user's
  overlapping link replaced it, you get an error instead of a success message,
  and further writes to that task are blocked until refresh.

A write that lands between another user's reread and write, or after their
verification, still wins (**last-write-wins**). Busy flags and duplicate-click
protection apply only within one app instance, not across users or browsers.
Refresh and check Workfront when coordinating concurrent changes.

### Form feedback and notifications

Create and edit forms associate field-validation errors with their inputs,
mark invalid fields, and clear the error state when corrected. Error text sits
outside the field label, so it is announced as a description rather than as
part of the field name. Request failures remain separate, form-level alerts.
Notifications use the shared EW `showToast` component, with dismissible,
six-second success/error messages; multiple notifications can stack. The
component is loaded without blocking startup; if it cannot be loaded, the app
logs the failure and shows a minimal local notification instead. The forms
retain native dialogs for now.

## Contribution

Node 18 or later, from the repository root:

```sh
node --test test/tools/apps/workfront/*.test.js
```

Or run `npm test` inside this directory. The repository-root `npm test` also
includes these tests. No `npm install` is needed.

For browser regression tests, open the local app with `?demo` and run in the
browser console (this creates a demo task and edits it in memory):

```js
const { default: runFormTests } = await import('/test/tools/apps/workfront/forms.browser.js');
await runFormTests();
```

### Scrolling regression check

Open the plugin in an EW side panel and select **All** with enough items to
extend below the viewport. Verify that mouse-wheel or trackpad scrolling over
the list reaches the last item, then returns to the top. Repeat in Tasks and
Projects with a row expanded, at narrow and wide panel widths. Confirm that
details appear between the expanded row and the next row, not after the list.
The app body must remain in normal document flow so the iframe document can scroll.
