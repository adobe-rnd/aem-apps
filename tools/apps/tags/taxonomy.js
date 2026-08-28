/**
 * Taxonomy sheet reading + tree model, shared by this app and
 * `tools/plugins/tags/tags.js` (which imports `resolveTaxonomyLocation`,
 * `fetchTaxonomySheet`, `parseTaxonomyTree`, and `flattenTaxonomyTags`
 * directly from here) — one canonical implementation of the taxonomy.json
 * contract instead of two copies drifting apart.
 *
 * A namespace, category, and tag are all the same node shape —
 * `{ name, description, children }` — differing only in depth and whether
 * they currently have children. `parseTaxonomyTree` + `serializeTaxonomyTree`
 * convert between that tree and `taxonomy.json`'s flat sheet rows.
 *
 * `Namespace` is the only inherited/stateful column: a `Namespace` row sets
 * the "current namespace" for every row that follows, until the next one.
 * `Category` is never inherited — a `Tag` row carries its own `Category`
 * (the full `/`-joined path within its namespace, omitted for a tag directly
 * under the namespace) directly on the row. This is what lets a namespace
 * mix direct tags and categorized tags in any order without ambiguity: a
 * `Tag` row's placement in the sheet doesn't affect where it attaches, only
 * its own `Category` field does.
 *
 * A category is just a tag that happens to have children — there's no
 * separate row shape for it. Every node gets one `Tag` row (its own name in
 * `Tag`, its ancestors' `/`-joined path in `Category`), whether or not it
 * currently has children, so a category is applicable as a tag in its own
 * right (see `flattenTaxonomyTags`) exactly like any of its descendants. A
 * `Category`-only row (no `Tag`) is still accepted when parsing — for
 * hand-edited sheets predating this, or written some other way — but
 * `serializeTaxonomyTree` never emits one.
 *
 * Every serialized row carries all four columns (`Namespace`/`Category`/
 * `Tag`/`Description`), using an empty string for whichever don't apply —
 * matching a real spreadsheet's rectangular shape, since AEM/DA's column
 * detection doesn't reliably pick up a column that's simply absent from a
 * row's keys.
 */

export const DA_ORIGIN = 'https://admin.da.live';

const DEFAULT_TAXONOMY_PATH = '/taxonomy.json';

/**
 * Resolves where a site's taxonomy sheet lives: defaults to `taxonomy.json`
 * at the site's DA source root, but `customPath` can point elsewhere —
 * either a path within this org/repo, or a full DA source URL (to manage a
 * taxonomy shared across sites/orgs). Also returns `org`/`repo`/`path`
 * separately (not just the fetch URL), so save/preview/publish can target
 * the right site even when a full cross-site URL was given.
 * @param {string} org Current org (used when no override, or a bare path)
 * @param {string} repo Current repo (used when no override, or a bare path)
 * @param {string} customPath Optional override: bare path or full DA source URL
 * @returns {{ org: string, repo: string, path: string, sourceUrl: string }}
 */
export function resolveTaxonomyLocation(org, repo, customPath) {
  const trimmed = (customPath || '').trim();

  if (!trimmed) {
    return {
      org,
      repo,
      path: DEFAULT_TAXONOMY_PATH,
      sourceUrl: `${DA_ORIGIN}/source/${org}/${repo}${DEFAULT_TAXONOMY_PATH}`,
    };
  }

  if (/^https?:\/\//i.test(trimmed)) {
    const match = trimmed.match(/\/source\/([^/]+)\/([^/]+)(\/.*)$/);
    if (match) {
      const [, matchedOrg, matchedRepo, path] = match;
      return {
        org: matchedOrg, repo: matchedRepo, path, sourceUrl: trimmed,
      };
    }
    return {
      org, repo, path: DEFAULT_TAXONOMY_PATH, sourceUrl: trimmed,
    };
  }

  const path = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return {
    org, repo, path, sourceUrl: `${DA_ORIGIN}/source/${org}/${repo}${path}`,
  };
}

/**
 * Fetches the taxonomy sheet's DA source (draft), not the published site, so
 * edits made here are immediately reflected — same as the tags picker reads.
 *
 * Takes the fetch function as a parameter rather than importing one, since
 * the app (running directly on da.live) and the plugin (running in a
 * cross-origin editor iframe) need different ones — the app uses its own
 * top-level `daFetch` import, the plugin must use the SDK's
 * `actions.daFetch`, which relays the auth token from the parent frame.
 * @param {Function} daFetchFn
 * @param {string} sourceUrl
 * @returns {Promise<{ok: boolean, status: number, sheet: Object|null}>}
 */
export async function fetchTaxonomySheet(daFetchFn, sourceUrl) {
  try {
    const response = await daFetchFn(sourceUrl);
    if (!response.ok) return { ok: false, status: response.status, sheet: null };
    return { ok: true, status: response.status, sheet: await response.json() };
  } catch (error) {
    return {
      ok: false, status: 0, sheet: null, error: error.message,
    };
  }
}

const TAXONOMY_COLUMNS = ['Namespace', 'Category', 'Tag', 'Description'];

/**
 * True if `sheet` looks like taxonomy.json's schema — an empty sheet always
 * passes (nothing to contradict), otherwise its first row must carry one of
 * the expected columns. Catches sheets that exist but use an unrelated
 * schema (e.g. a flat `key`/`value` tag list some sites already have at
 * `taxonomy.json`), which `parseTaxonomyTree` would otherwise silently parse
 * into an empty tree instead of surfacing as an error.
 * @param {Object} sheet Raw sheet envelope (`{ data }`)
 * @returns {boolean}
 */
export function hasTaxonomySchema(sheet) {
  const rows = Array.isArray(sheet?.data) ? sheet.data : [];
  if (rows.length === 0) return true;
  return TAXONOMY_COLUMNS.some((col) => Object.prototype.hasOwnProperty.call(rows[0], col));
}

function createNode(name, description = '') {
  return { name, description, children: [] };
}

/**
 * Finds (or creates) a namespace node by name, preserving first-seen order.
 * @param {Object[]} namespaces
 * @param {Map<string, Object>} byName
 * @param {string} name
 * @param {string} description
 * @returns {Object} The namespace node
 */
function ensureNamespace(namespaces, byName, name, description) {
  let ns = byName.get(name);
  if (!ns) {
    ns = createNode(name, description);
    byName.set(name, ns);
    namespaces.push(ns);
  }
  return ns;
}

/**
 * Walks (creating as needed) the chain of nested nodes described by a
 * `/`-joined category path, returning the deepest one.
 * @param {Object} namespace Namespace node to walk/create nodes under
 * @param {string} categoryPath e.g. `catlev1/catlev2`
 * @param {string} description Applied to the deepest (last) node in the path
 * @returns {Object} The deepest node in the path
 */
function ensureCategoryPath(namespace, categoryPath, description) {
  const parts = categoryPath.split('/').map((part) => part.trim()).filter(Boolean);
  let siblings = namespace.children;
  let node = null;
  parts.forEach((part, i) => {
    node = siblings.find((child) => child.name === part);
    if (!node) {
      node = createNode(part, i === parts.length - 1 ? description : '');
    } else if (i === parts.length - 1 && description) {
      node.description = description;
    }
    if (!siblings.includes(node)) siblings.push(node);
    siblings = node.children;
  });
  return node;
}

/**
 * Parses `taxonomy.json`'s flat `data` rows into a namespace tree.
 * `Namespace` is the only inherited column — a `Namespace` row sets the
 * current namespace for every row after it, until the next one. `Category`
 * is read directly off each row: a `Tag` row attaches under whatever
 * `Category` path it names (or directly under the namespace if omitted), and
 * a `Category`-only row just declares/describes that path, creating any
 * missing ancestors along the way.
 * @param {Object[]} rows Raw `taxonomy.json` `data` rows
 * @returns {{ namespaces: Object[] }} The parsed tree
 */
export function parseTaxonomyTree(rows = []) {
  const namespaces = [];
  const byName = new Map();
  let currentNamespace = null;

  rows.forEach((row) => {
    if (row.Namespace) {
      currentNamespace = ensureNamespace(namespaces, byName, row.Namespace, row.Description || '');
      return;
    }
    if (!currentNamespace) return;

    if (row.Tag) {
      const target = row.Category
        ? ensureCategoryPath(currentNamespace, row.Category, '')
        : currentNamespace;
      target.children.push(createNode(row.Tag, row.Description || ''));
      return;
    }
    if (row.Category) {
      ensureCategoryPath(currentNamespace, row.Category, row.Description || '');
    }
  });

  return { namespaces };
}

/**
 * Every row always carries all four columns (empty string where a column
 * doesn't apply to that row) instead of only the keys relevant to that row.
 * A real spreadsheet-backed sheet is rectangular — every row has a cell for
 * every column — and AEM/DA's column detection reflects that: it doesn't
 * reliably pick up a column (e.g. `Category`/`Tag`) that's simply absent
 * from enough rows' keys, even when it's declared in the sheet's `columns`
 * list. `parseTaxonomyTree` already treats an empty string the same as a
 * missing key (both are falsy), so this doesn't change parsing.
 * @param {{ namespace, category, tag, description }} parts
 * @returns {Object} A fully-keyed row
 */
function makeRow({
  namespace = '', category = '', tag = '', description = '',
}) {
  return {
    Namespace: namespace, Category: category, Tag: tag, Description: description,
  };
}

/**
 * Serializes a namespace tree back into `taxonomy.json`'s flat `data` rows.
 * Every node — tag or category alike — gets one `Tag` row: its own name in
 * `Tag`, its ancestors' `/`-joined path in `Category` (empty for a node
 * directly under the namespace), rather than relying on a preceding header
 * row. A category's row looks exactly like a tag's, then its children (if
 * any) follow as their own rows — a category is only a tag with children,
 * not a different row shape.
 * @param {{ namespaces: Object[] }} tree
 * @returns {Object[]} Flat sheet rows
 */
export function serializeTaxonomyTree(tree) {
  const rows = [];

  const serializeChildren = (children, ancestorPath) => {
    children.forEach((child) => {
      rows.push(makeRow({
        category: ancestorPath.join('/'), tag: child.name, description: child.description,
      }));
      if (child.children.length > 0) {
        serializeChildren(child.children, [...ancestorPath, child.name]);
      }
    });
  };

  (tree?.namespaces || []).forEach((namespace) => {
    rows.push(makeRow({ namespace: namespace.name, description: namespace.description }));
    serializeChildren(namespace.children, []);
  });

  return rows;
}

/**
 * Flattens every node under a namespace (both tags and categories) into the
 * `{ namespace, category, tag, path, description }` shape the tags plugin's
 * picker uses, so it and this app's search always agree on a tag's `path`
 * string. A category is itself selectable (applied as a tag in its own
 * right, e.g. `Tag Driven:catlev1`), not just a container walked into to
 * reach its descendants — a node's role (bare tag vs. category) only
 * affects whether it has anything nested under it, not whether it can be
 * applied on its own.
 * @param {{ namespaces: Object[] }} tree
 * @returns {Object[]} Flat list of selectable tags
 */
export function flattenTaxonomyTags(tree) {
  const out = [];

  (tree?.namespaces || []).forEach((namespace) => {
    const walk = (node, ancestorPath) => {
      const categoryPath = ancestorPath.join('/');
      const path = categoryPath
        ? `${namespace.name}:${categoryPath}/${node.name}`
        : `${namespace.name}:${node.name}`;
      out.push({
        namespace: namespace.name,
        category: categoryPath,
        tag: node.name,
        description: node.description,
        path,
      });
      node.children.forEach((child) => walk(child, [...ancestorPath, node.name]));
    };

    namespace.children.forEach((child) => walk(child, []));
  });

  return out;
}

/**
 * Wraps flat rows in AEM's single-sheet JSON envelope
 * (https://www.aem.live/developer/spreadsheets#single-sheet-format).
 * `:type: 'sheet'` is required — without it, admin rejects the sheet on
 * preview/publish with "invalid sheet; unknown type".
 * @param {Object[]} rows
 * @returns {Object}
 */
export function buildTaxonomySheet(rows) {
  return {
    total: rows.length,
    limit: rows.length,
    offset: 0,
    data: rows,
    columns: ['Namespace', 'Category', 'Tag', 'Description'],
    ':type': 'sheet',
  };
}
