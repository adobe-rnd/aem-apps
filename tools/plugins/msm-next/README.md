# Multi-site Management (next) plugin

DA Prepare-menu panel for the msm-next prototype, built on `tools/localization/core`. Single column (360–600px), following the UX panel proposal:

1. "Multi-site" row with a `⋯` menu: Replace with source, Unlink / Relink, Revert to inherited, Create local copy, Preview, Publish, Publish with inherited pages, Open source in editor, Open MSM app.
2. Page title, locale badge, status pill (most urgent sync state) and "Last synced".
3. One state card: Available updates (Sync now / Translate now, Compare with source), Conflicts (needs review; locks linked variations), Waiting for source review, Translation in progress (Check status; checked once on open), Translation ready (Save translation), Inherited (Publish), Not created (Create / Inherit), Independent (Relink). Action results show below the card.
4. Linked variations: pages that use this page as their source, "+ Create linked variation" (location picker, Merge / Replace, Run → `propagate` with `targets`) and "Publish with inherited pages".
5. Page details: Type, Source, Language, Locale, Location, Published.

## Setup

Add a row to the org or site `prepare` sheet:

| title | path | icon | experience |
| --- | --- | --- | --- |
| Multi-site Management (next) | `https://main--aem-apps--adobe-rnd.aem.live/tools/plugins/msm-next/msm-next.html` | `https://da.live/blocks/edit/img/S2_Icon_GlobeGrid_20_N.svg#S2_Icon_GlobeGrid` | dialog |

Sites need a `locations` sheet (see `tools/localization/core/README.md`).

## Mock mode

`?mock=1` (or no DA SDK within 5s) uses the msm-next mock data. Pick the page with `site` and `path`:

`/tools/plugins/msm-next/msm-next.html?mock=1&site=gamebox&path=/emea/hardware/console.html`

## Real mode

Uses the DA SDK's `actions.daFetch` for the legacy api, `nx/public/loc` for copies and the Google translation connector through the DA translate proxy. `?translateDelay=<ms>` sets the connector's `simulatedDelayMs` (default 0). If the connector can't be created, the panel shows a notice and translate is disabled.

## Files

- `msm-next.js`: `<msm-next-plugin>` and DA SDK / mock setup
- `model.js`: pure logic (header, state card, menu, details, target tree and picker, run summary); tests in `test/tools/plugins/msm-next`
- `real-localization.js`: core facade over `actions.daFetch`, `nx/public/loc` and the translation connector
