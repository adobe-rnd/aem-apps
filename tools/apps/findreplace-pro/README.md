# FindReplace Pro

A standalone Experience Workspace (EW) app for searching site content, replacing
matches in bulk, and previewing, publishing, or unpublishing selected files.
Supports text, regular expressions, HTML blocks, and element discovery, with
version backups before content changes. JSON search is read-only.

## How to Use

Open **FindReplace Pro** in Experience Workspace, then configure the content
organization and site you want to work with.

### 1. Configure
1. Enter **Organization/Site** in `/org/site` format.
2. Optionally add **Search Paths** to limit the search to specific folders.
3. Check **Include Subfolders** to search nested folders. When unchecked (the
   default), only files directly inside each search path (or the site root) are
   scanned.
4. Expand **Advanced Filters** to configure search options. Path exclusions and
   modification-date filtering currently apply to JSON discovery.

### 2. Search
1. **Search For**: Enter text to find (or leave empty for element discovery)
2. **Search Type**: Contains, Exact Match, or Regular Expression
3. **Options**: Enable case-sensitive search or HTML Mode
4. **Target Content**: Choose All Content, Page Metadata Only, Section Metadata Only, Block Content Only, Main Content Only, or Custom Selector
5. **Advanced Filters**: Exclude URLs, set paths to exclude, or filter by modification date
 
### 3. Scan & Filter
1. Click **Scan & Preview** to search your site
2. Use **filter box** to narrow results by path or content
3. Use **accordion toggles** to expand/collapse individual file matches
4. Navigate with **pagination** if many results

### 4. Select & Execute
**For content changes:**
1. Select files using checkboxes (or use Select All/Clear Selection)
2. Enter **replacement text** (use $1, $2 for regex groups)
3. Click **"Execute Replace"**

**For publishing:**
1. Select files to publish
2. Choose operation: **Preview/Publish/Unpublish**
3. Click operation button (shows count: "Publish Selected (3)")
4. Monitor progress and results

**For reverting changes:**
1. Select files to revert
2. Click **"Revert Selected"** (shows count: "Revert Selected (2)")
3. Confirm restoration to most recent saved versions
4. Monitor progress - automatic backup created before revert

### JSON Search (Search-only)
1. Open **Advanced Filters** and enable **Find JSON files**.
2. Enter a **Search For** term (supports Contains, Exact Match, and Regular Expression with case sensitivity).
3. Click **Scan & Preview**.
4. Review results; replacement is disabled in JSON mode.
5. Click a JSON result to open the resource in the sheet editor (e.g., `https://da.live/sheet#/org/site/path`).

## Configuration

Register the app for Experience Workspace in a site's DA config sheet,
**apps** tab (`title` / `description` / `image` / `path` columns):

| title | description | image | path |
| --- | --- | --- | --- |
| `FindReplace Pro` | Bulk find and replace with publishing workflow | `https://main--aem-apps--adobe-rnd.aem.page/tools/apps/findreplace-pro/icons/search.svg` | `/app/adobe-rnd/aem-apps/tools/apps/findreplace-pro/findreplace-pro` |

For existing app registrations, update the apps-tab path and image URL to the
values above after deploying the renamed app.

Enter the content organization and site in the app's **Organization/Site**
field. The DA App SDK provides the Experience Workspace session context and
authentication, but the app
does not automatically populate this field from that context. Valid org/site
input is cached in memory for the current app session.

The app entry point is `/tools/apps/findreplace-pro/findreplace-pro.html`. Keep its HTML,
JavaScript, stylesheet, and icons together: static assets use sibling paths,
and dynamically generated icons resolve relative to the JavaScript module.

## How It Works

### Search and Discovery

- **Content search** — search all content or scope to page metadata, section
  metadata, block content, main content, or a custom CSS selector.
- **Element discovery** — leave the search term empty to find pages containing
  the selected elements.
- **Search types** — Contains, Exact Match, and Regular Expression, with optional
  case-sensitive matching and regex replacement groups (`$1`, `$2`).
  Text, HTML, and JSON searches support zero-width regex matches such as anchors
  and lookaheads without getting stuck during match iteration.
- **HTML Mode** — search and replace entire HTML blocks using a shared pattern
  for scanning and execution. Both operate on raw DA source; literal patterns
  allow optional paragraph tags and some whitespace variations.
- **Multi-path search** — select multiple directories using tags, autocomplete,
  and path validation.
- **Filters** — JSON discovery supports path exclusions and modification-date
  filters. Content search can exclude URLs and attributes (`href`, `src`,
  `srcset`, `data-*`, etc.).
- **JSON discovery and search** — detect JSON by parsing after minimal
  normalization, then search its raw text. JSON results open in the sheet editor;
  replacement is disabled.

### Content Management and Safety

| Action | Description |
| --- | --- |
| **Execute Replace** | Replace content in selected files, with individual match selection and regex replacement groups. |
| **Replace with empty** | Insert `&nbsp;` in text mode; remove matched HTML in HTML Mode. |
| **Revert Selected** | Restore selected files to their most recent saved versions. |
| **Preview / Publish / Unpublish** | Run the selected publishing operation with progress tracking. |
| **Export Files** | Download selected files with match results. |

Replacement requires a backup version via the DA Version Source API
(`/versionsource/`). Revert uses the DA Version List API (`/versionlist/`) to
find saved versions. Both replacement and revert require successful backup
creation before writing content; failed backups skip the affected file without
saving changes. Revert selects and fetches the newest labeled version with a URL
and timestamp before creating the safety backup, so that backup cannot become
the restore target. Bulk results distinguish successful writes, skipped backups,
and failed writes. Review the operational limits below before making bulk changes.

Publishing uses the AEM Admin API (`admin.hlx.page`), with `main` for
publish/unpublish and the current branch for preview.
All three operations target the organization and site entered in the app.
DA source paths are converted to site-relative paths before sending requests;
for example, `/org/site/drafts/page.html` becomes `/drafts/page`.
The DA SDK session token is forwarded as a Bearer token; no separate Admin API
login or token refresh is performed. The session must have the required access
to the target site. Bulk responses report job initiation, not verified completion
of each resource.


## Examples

### Find all pages with hero blocks
- **Target Content**: Custom Selector
- **Custom CSS Selector**: `.hero`
- **Search For**: (leave empty)

### Remove "- Adobe" from titles
- **Target Content**: Page Metadata Only
- **Search Type**: Contains
- **Search For**: `- Adobe`
- **Replace With**: (empty to remove)
- **Replace with empty**: Enable checkbox

### Regex: Reformat phone numbers
- **Search Type**: Regular Expression
- **Search For**: `(\d{3})-(\d{3})-(\d{4})`
- **Replace With**: `($1) $2-$3`
- **Result**: `312-555-1234` → `(312) 555-1234`

### Regex: Swap name format
- **Search Type**: Regular Expression
- **Search For**: `([A-Z][a-z]+), ([A-Z][a-z]+)`
- **Replace With**: `$2 $1`
- **Result**: `Smith, John` → `John Smith`

### HTML Mode: Replace entire HTML blocks
- **HTML Mode**: Enable checkbox
- **Search For**: `<div class="hero"><h1>Old Title</h1></div>`
- **Replace With**: `<div class="banner"><h2>New Title</h2></div>`
- **Result**: Complete HTML block replacement

### JSON: Find a property value
- **Advanced Filters**: Enable **Find JSON files**
- **Search Type**: Regular Expression
- **Search For**: `"status":\s*"draft"`
- **Result**: Lists JSON files containing the property; edit in the sheet editor if needed

### Filter and bulk publish
1. Search for content
2. Filter results: type `/blog` to show only blog pages
3. Select All → Publish Selected (15)

## Files

| File | Purpose |
| --- | --- |
| `findreplace-pro.html` | App shell, search configuration, results, and action controls |
| `findreplace-pro.js` | DA SDK initialization, search, bulk operations, versioning, and UI behavior |
| `findreplace-pro-utils.js` | Dependency-free matching, context, empty-page, and legacy formatting helpers |
| `findreplace-pro.css` | Spectrum-token app layout, native controls, themes, and icon styles |
| `icons/` | SVG assets for static and dynamically generated UI |
| `README.md` | App setup, usage, and technical documentation |

## Dependencies

- [DA App SDK](https://da.live/nx/utils/sdk.js) — Experience Workspace integration,
  session context, and token for authenticated access to DA Source and List APIs
- [DA Tree Utility](https://da.live/nx/public/utils/tree.js) — folder crawling
- [nx2 Spectrum Styles](https://da.live/nx2/styles/styles.css) — shared typography
  and light/dark design tokens
- [DA Admin API](https://admin.da.live) — content listing, source access, and
  version creation/restoration
- [AEM Admin API](https://www.aem.live/docs/admin.html) — preview, publish, and
  unpublish operations via `admin.hlx.page`
- No build step; vanilla JavaScript and plain ES modules

## Development Checks

Run from the repository root with Node.js available:

```sh
node --test test/tools/apps/findreplace-pro/*.test.js
npx eslint tools/apps/findreplace-pro/*.js test/tools/apps/findreplace-pro/*.test.js
npx stylelint tools/apps/findreplace-pro/findreplace-pro.css
```

The focused suite covers the main search and replacement workflows, read-only
JSON search, preview/publish/unpublish request contracts, and backup-before-write
safety. It retains regression coverage for zero-width regex matches, failed
backups, restore ordering, and bulk outcome reporting. UI-only checks and
exhaustive helper/edge-case matrices are intentionally omitted. API calls are
mocked; tests never write to a live site.