# Multi-site Management (next) plugin

DA Prepare-menu dialog for the msm-next prototype. Shows the open page's MSM status, its source chain, the pages that use it as their source, and every available action. Built on `tools/localization/core`.

## Setup

Add a row to the org or site `prepare` sheet:

| title | path | icon | experience |
| --- | --- | --- | --- |
| Multi-site Management (next) | `https://main--aem-apps--adobe-rnd.aem.live/tools/plugins/msm-next/msm-next.html` | `https://da.live/blocks/edit/img/S2_Icon_GlobeGrid_20_N.svg#S2_Icon_GlobeGrid` | dialog |

Sites need a `locations` sheet (see `tools/localization/core/README.md`).

## Mock mode

`?mock=1` (or no DA SDK within 5s) uses the msm-next mock data. Pick the page with `site` and `path`:

`/tools/plugins/msm-next/msm-next.html?mock=1&site=gamebox&path=/emea/hardware/console.html`

## Files

- `msm-next.js`: `<msm-next-plugin>` and DA SDK / mock setup
- `model.js`: pure logic (sections, buttons, target tree, run summary); tests in `test/tools/plugins/msm-next`
- `real-localization.js`: core facade over `actions.daFetch` and `nx/public/loc`
