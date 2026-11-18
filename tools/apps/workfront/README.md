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
| `workfront.origin.proxy` | Optional HTTPS proxy origin; leave blank or omit for direct requests |

The plugin connects through the official [EW/DA SDK](https://da.live/nx/utils/sdk.js).

**Note** to access Workfront APIs currently a CORS proxy is needed, a sample implementation can be found in the `cors` subfolder.

## Find items and users

The compact toolbar keeps **New task** beside search and **Refresh** beside the
connection status. Refresh is hidden while connecting. Page context still comes
from EW for filtering, linking, and creating tasks, without repeating it in a header.

**Assigned to me** is the first context filter; **This page** remains the default
context. **Tasks** is the default tab, with **Projects** beside it. Both use the
same accordion layout and start with no item open. Click a row, or focus it and
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

## Contribution

Node 18 or later, from the repository root:

```sh
node --test test/tools/apps/workfront/*.test.js
```

Or run `npm test` inside this directory. The repository-root `npm test` also
includes these tests. No `npm install` is needed.

### Scrolling regression check

Open the plugin in an EW side panel and select **All** with enough items to
extend below the viewport. Verify that mouse-wheel or trackpad scrolling over
the list reaches the last item, then returns to the top. Repeat in Tasks and
Projects with a row expanded, at narrow and wide panel widths. Confirm that
details appear between the expanded row and the next row, not after the list.
The app body must remain in normal document flow so the iframe document can scroll.
