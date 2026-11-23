# Multi-site Management

Multi-site Management lets you run regional and language sites from one place. You define how your locations relate, then roll out changes, translate pages, and review proposed changes for each market.

It works in two places:

- **The Multi-site Management app** shows every location and page of a site, and runs actions on many pages at once.
- **Editor panels** show the state of the page you are editing and the content proposals for it.

## What you can do

- **See every page and its state.** Each page is a source, a local copy, a translation, an inherited page, or an independent page. The app shows which pages are behind their source, need review, are being translated, or are not published.
- **Roll out changes.** Update or create pages in the target locations of a source page in one rollout. **Merge** keeps local edits where possible. **Replace** overwrites the target page.
- **Translate.** Send pages to the translation service, then save the translation when it is ready.
- **Inherit pages.** A location can serve a page from its source until it needs its own copy. Publish an inherited page, or publish a source page together with every page that inherits from it.
- **Review content proposals.** A proposal suggests a change for a target page, adapted to that market. The page owner reviews the changes, then approves or rejects them. Approving merges the change and keeps the page's own edits.
- **Configure locations** in the app's **Configuration** tab.

## Open the app

Open the app and enter your organization and site:

https://da.live/app/adobe-rnd/aem-apps/tools/apps/msm-next/msm-next?ref=msm-next

To open a site directly, add it to the URL, for example `...msm-next?ref=msm-next#/my-org/my-site`.

## Set up

### 1. Define your locations

Each site has a `locations` sheet in its site configuration. You can edit it in the app's **Configuration** tab, or in the site config at `https://da.live/config#/<org>/<site>/`.

Each row is a location. A location names its source. A source never lists its targets.

| path | language | label | source | actions | missingPages |
| --- | --- | --- | --- | --- | --- |
| /en-us | en-US | United States | | | |
| /en-ca | en-CA | Canada (English) | /en-us | rollout | linked |
| /fr-ca | fr-CA | Canada (French) | /en-ca | translate | none |

| Column | Values | Default |
| --- | --- | --- |
| path | The location's folder, for example `/en-ca`, or `/` for the whole site | `/` |
| language | A language code, for example `en`, `en-CA`, `es-419` | Required |
| label | The display name | Built from the language |
| level | Free text, for example `Region` or `Locale` | Empty |
| source | `/path` in the same site, or `site:/path` in another site. Empty for a root location. | Empty |
| actions | `link`, `rollout`, `translate` | `rollout` |
| missingPages | `linked` serves the source page until the location has its own copy. `none` shows the page as not created. | `none` |
| conflictBehavior | `merge`, `overwrite`. The first value is the default. | `merge` |
| onComplete | `none`, `preview`, `publish`: what happens after a rollout or translation | `none` |
| translationProvider | The translation service. `google` is supported. | Empty |

A root location leaves the relationship columns empty. Locations can chain up to five levels deep, and across sites in the same organization.

### 2. Add the editor panels

Add these rows to the site's `library` sheet in the site config:

| title | path | icon | experience |
| --- | --- | --- | --- |
| Multi-site Management | `https://msm-next--aem-apps--adobe-rnd.aem.live/tools/plugins/msm-next/msm-next.html` | `https://da.live/blocks/edit/img/S2_Icon_GlobeGrid_20_N.svg#S2_Icon_GlobeGrid` | inline |
| Content proposals | `https://msm-next--aem-apps--adobe-rnd.aem.live/tools/plugins/proposals/proposals.html` | `https://da.live/blocks/edit/img/S2_Icon_FileText_20_N.svg#S2_Icon_FileText` | inline |

### 3. Deliver inherited pages

Inherited pages have no file of their own. Delivery serves them from their source through the Multi-site Management content provider. Ask your Adobe contact to enable it for sites that use `missingPages: linked`.

## Work with a page

Open a page in the editor and open the **Multi-site Management** panel. It shows:

- the page's state and the next step, for example **Sync now**, **Translate now**, or **Publish**;
- the pages that use this page as their source, and **Create linked variation**;
- the page's source, language, location, and publish state.

The **Content proposals** panel shows the proposals that involve the open page:

- On a target page: **Review changes**, **Approve**, or **Reject**.
- On a source page: each target page and its state.
- **Create proposal** asks the assistant to prepare a proposal for the latest changes on the page, for the target pages you choose.

## Known issues

- You see only the target locations in sites you can access. A location's targets are found by reading the config of every site in the organization.
- Pages must have the same path in every location. Localized paths, for example `/fr/produits` for `/en/products`, are not supported.
- Rollouts and translations copy pages. Sheets and media are not copied.
- Rollout, translate, and save are not available for sites on the Helix 6 content API.
- Review a page after a merge. Large structural differences between a source and a target page can give unexpected results.

## Sites that use the `msm` sheet

Sites set up with base and satellite sites in the org `msm` sheet use the [Multi-Site Manager](https://www.aem.live/docs/ew/administering/multi-site-manager) tools.
