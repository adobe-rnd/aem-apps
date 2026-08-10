# CUG — Page Access (Closed User Groups)

A DA (Document Authoring) tool that applies or removes [Closed User Group](https://main--helix-website--adobe.aem.page/drafts/jkautzma/closed-user-groups) (CUG) access restrictions for a site, based on a `closed-user-groups` sheet authored in DA.

## Overview

Closed User Groups restrict access to pages at the CDN edge using headers on the site's Config Service (`headers.json`). On AEM Sites this is handled automatically when the sheet is published, but Document Authoring sites have no equivalent, so this tool reads the authored sheet and posts the resulting header configuration to the Config Service.

## How It Works

1. Fetches the site's `closed-user-groups.json` sheet from DA (`/source/{org}/{site}/closed-user-groups.json`).
2. Converts each row into the `x-aem-cug-required`, `x-aem-cug-groups`, and `x-aem-cug-login-path` headers, keyed by the row's `url` path. See the linked docs for the sheet's column format and header semantics.
3. Reads the site's existing `headers.json` config and strips out any previously-applied CUG headers, preserving all other (non-CUG) header entries.
4. Merges the fresh CUG headers with the preserved non-CUG headers and POSTs the combined config back to `headers.json`.

**Remove Page Access** re-runs steps 3–4 without re-applying CUG headers, so it clears CUG restrictions while leaving other headers untouched.

Only the first row for a given `url` is used; duplicate paths in the sheet are ignored.

## Architecture

### Files

```
tools/apps/cug/
├── cug.html   # Entry point (DA tool shell page)
├── cug.js     # Fetches the sheet, transforms rows to headers, applies/removes via the Config Service
└── cug.css    # Styles
```

### External Dependencies

| Dependency | Source | Purpose |
|---|---|---|
| DA SDK | `https://da.live/nx/utils/sdk.js` | Provides auth context (org, site) and token |

### APIs

| Endpoint | Host | Methods | Purpose |
|---|---|---|---|
| `/source/{org}/{site}/closed-user-groups.json` | `admin.da.live` | GET | Read the authored CUG sheet |
| `/config/{org}/aggregated/{site}.json` | `admin.hlx.page` | GET | Read the site's current aggregated config (to preserve non-CUG headers) |
| `/config/{org}/sites/{site}/headers.json` | `admin.hlx.page` | POST | Write the merged headers config |

## Usage

1. Author a `closed-user-groups` sheet at the site root in DA (see the [docs](https://main--helix-website--adobe.aem.page/drafts/jkautzma/closed-user-groups) for the column format).
2. Open the CUG tool from the DA interface (hosted at `/tools/apps/cug/cug`).
3. Click **Apply Page Access** to push the sheet's restrictions live, or **Remove Page Access** to clear all CUG headers for the site.
