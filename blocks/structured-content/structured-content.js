/*
 * Copyright 2026 Adobe Systems Incorporated
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/*
 * Structured Content Block
 * Renders a structured content document referenced by an aem.page/aem.live
 * link, fetching its JSON from the structured content delivery endpoint:
 * https://da-sc.adobeaem.workers.dev/<live|preview>/<org>/<site>/<path>
 * https://www.aem.live/docs/ew/administering/structured-content#delivery-endpoint
 */

const SC_DELIVERY = 'https://da-sc.adobeaem.workers.dev';

/**
 * Delivery endpoint for a reference link.
 * @param {string} href link authored in the block (main--site--org.aem.page/path)
 * @param {string} pageHost hostname of the page rendering the block
 * @returns {string|null}
 */
export function getDeliveryUrl(href, pageHost) {
  let url;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const match = url.hostname.match(/^[^.]+--([^.]+)--([^.]+)\.aem\.(page|live)$/);
  if (!match) return null;
  const [, site, org] = match;
  const preview = pageHost === 'localhost' || pageHost.endsWith('.aem.page');
  const path = url.pathname.replace(/\.(html|json)$/, '').replace(/\/$/, '');
  if (!path) return null;
  return `${SC_DELIVERY}/${preview ? 'preview' : 'live'}/${org}/${site}${path}`;
}

function toKebab(key) {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
}

function renderValue(value) {
  if (Array.isArray(value)) {
    const ul = document.createElement('ul');
    value.forEach((item) => {
      const li = document.createElement('li');
      li.append(renderValue(item));
      ul.append(li);
    });
    return ul;
  }
  if (value && typeof value === 'object') {
    const dl = document.createElement('dl');
    Object.entries(value).forEach(([key, val]) => {
      const dt = document.createElement('dt');
      dt.textContent = key;
      const dd = document.createElement('dd');
      dd.className = `sc-${toKebab(key)}`;
      dd.append(renderValue(val));
      dl.append(dt, dd);
    });
    return dl;
  }
  return document.createTextNode(value === undefined || value === null ? '' : String(value));
}

/**
 * Generic renderer used when no schema-specific renderer exists.
 * @param {Element} block
 * @param {object} data structured content payload (json.data)
 */
export function renderGeneric(block, data) {
  block.replaceChildren(renderValue(data));
}

/**
 * Module path of the renderer for a schema name, or null if the name is unsafe.
 * Renderers live in ./renderers/<schema>.js and export a default
 * `(block, data, metadata) => void | Promise<void>`.
 * @param {string} schema
 * @returns {string|null}
 */
export function rendererPath(schema) {
  if (!schema || !/^[a-z0-9][a-z0-9-_]*$/i.test(schema)) return null;
  return `${window.hlx.codeBasePath}/blocks/structured-content/renderers/${schema.toLowerCase()}.js`;
}

async function loadRenderer(schema) {
  const path = rendererPath(schema);
  if (!path) return renderGeneric;
  try {
    const mod = await import(path);
    return mod.default || renderGeneric;
  } catch {
    return renderGeneric;
  }
}

/**
 * loads and decorates the block
 * @param {Element} block The block element
 */
export default async function decorate(block) {
  const link = block.querySelector('a');
  const href = link ? link.href : block.textContent.trim();
  const url = getDeliveryUrl(href, window.location.hostname);
  if (!url) return;

  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();
    const { metadata = {}, data = json } = json;
    const schema = metadata.schemaName;
    if (schema) block.dataset.schema = schema;
    const render = await loadRenderer(schema);
    await render(block, data, metadata);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('structured-content: failed to load', url, error);
  }
}
