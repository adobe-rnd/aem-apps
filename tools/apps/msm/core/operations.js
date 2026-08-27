/* eslint-disable import/no-unresolved */
import {
  daFetch, DA_ORIGIN, AEM_ADMIN, cleanPath,
} from './fetch.js';

// da-nx's loc/project module migrated to nx2's daFetch on 2026-07-07 (da-nx
// commit e96292c), which always initiates its own IMS session and can't take
// a token we already have — that session bootstrap gets CORS-blocked outside
// da.live's own origin. Pinned to the last commit before that migration, via
// jsdelivr (correct JS content-type + immutable caching for a commit SHA), so
// merge keeps using nx1's daFetch, which setMergeAuthToken feeds our existing
// DA SDK token into.
const LOC_NX1_PIN = 'https://cdn.jsdelivr.net/gh/adobe/da-nx@9a6deb15f9cb5d18ae0e2fdb8ef0cfdc23cac282/nx';

const EXT_MIME_TYPES = {
  html: 'text/html',
  json: 'application/json',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf',
};

// `editUrlOrigin` builds the in-editor deep link returned to the UI. The dialog
// runs in a cross-origin iframe, so its init sets this to the real da.live host.
let editUrlOrigin = 'https://da.live';
export function setEditUrlOrigin(origin) { if (origin) editUrlOrigin = origin; }
export function getEditUrlOrigin() { return editUrlOrigin; }

let mergeAuthToken;
export function setMergeAuthToken(token) { mergeAuthToken = token; }

let mergeCopyFn;
export function setMergeCopy(fn) { mergeCopyFn = fn; }
async function ensureMergeCopy() {
  if (!mergeCopyFn) {
    const mod = await import(`${LOC_NX1_PIN}/blocks/loc/project/index.js`);
    mergeCopyFn = mod.mergeCopy;
  }
  if (mergeAuthToken) {
    const { setImsDetails } = await import(`${LOC_NX1_PIN}/utils/daFetch.js`);
    setImsDetails(mergeAuthToken);
  }
  return mergeCopyFn;
}

export async function previewPage(org, site, pagePath, ext = 'html') {
  const clean = cleanPath(pagePath, ext);
  const aemPath = ext === 'html' ? clean : `${clean}.${ext}`;
  const resp = await daFetch(`${AEM_ADMIN}/preview/${org}/${site}/main${aemPath}`, { method: 'POST' });
  if (!resp.ok) return { error: resp.headers?.get('x-error') || `Preview failed (${resp.status})` };
  return resp.json();
}

export async function publishPage(org, site, pagePath, ext = 'html') {
  const clean = cleanPath(pagePath, ext);
  const aemPath = ext === 'html' ? clean : `${clean}.${ext}`;
  const resp = await daFetch(`${AEM_ADMIN}/live/${org}/${site}/main${aemPath}`, { method: 'POST' });
  if (!resp.ok) return { error: resp.headers?.get('x-error') || `Publish failed (${resp.status})` };
  return resp.json();
}

// Detach a page on `targetSite` by writing it an independent copy of the
// source's content. Also the primitive behind a "replace" sync (overwrite the
// existing copy from source).
export async function copyFromSource(org, sourceSite, targetSite, pagePath, ext = 'html') {
  const clean = cleanPath(pagePath, ext);
  const sourceUrl = `${DA_ORIGIN}/source/${org}/${sourceSite}${clean}.${ext}`;
  const resp = await daFetch(sourceUrl);
  if (!resp.ok) return { error: `Failed to fetch source content (${resp.status})` };

  const content = await resp.blob();
  const mimeType = EXT_MIME_TYPES[ext] || 'application/octet-stream';
  const formData = new FormData();
  formData.append('data', new Blob([content], { type: mimeType }));

  const targetUrl = `${DA_ORIGIN}/source/${org}/${targetSite}${clean}.${ext}`;
  const saveResp = await daFetch(targetUrl, { method: 'PUT', body: formData });
  if (!saveResp.ok) return { error: `Failed to copy from source (${saveResp.status})` };
  return { ok: true };
}

// Reconnect a page by deleting its independent copy so it links to its source again.
export async function deleteCopy(org, site, pagePath, ext = 'html') {
  const clean = cleanPath(pagePath, ext);
  const resp = await daFetch(`${DA_ORIGIN}/source/${org}/${site}${clean}.${ext}`, { method: 'DELETE' });
  if (!resp.ok) return { error: `Failed to remove copy (${resp.status})` };
  return { ok: true };
}

export async function mergeFromSource(org, sourceSite, targetSite, pagePath, ext = 'html') {
  try {
    const clean = cleanPath(pagePath, ext);
    const mergeCopy = await ensureMergeCopy();
    const url = {
      source: `/${org}/${sourceSite}${clean}.${ext}`,
      destination: `/${org}/${targetSite}${clean}.${ext}`,
    };
    const result = await mergeCopy(url, 'MSM Merge');
    if (!result?.ok) return { error: 'Merge failed' };
    return { ok: true, editUrl: `${editUrlOrigin}/edit#/${org}/${targetSite}${clean}` };
  } catch (e) {
    return { error: e.message || 'Merge failed' };
  }
}
