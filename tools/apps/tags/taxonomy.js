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
 * A `Category`-only row (no `Tag`) is only needed to attach a `Description`
 * to a category itself — a category's existence is always implied by any
 * `Tag` row naming its path, and is created automatically. (A category with
 * no tags anywhere in its subtree is indistinguishable from a tag itself —
 * a node's role is defined solely by whether it currently has children.)
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
 * Serializes a namespace tree back into `taxonomy.json`'s flat `data` rows.
 * Every `Tag` row carries its own `Category` (full `/`-joined path, omitted
 * for a tag directly under the namespace) rather than relying on a preceding
 * header row. A category's own existence is always reconstructible from any
 * of its descendant `Tag` rows (a category, by definition, has at least one
 * child, which is itself either a tag or another category with the same
 * guarantee), so a `Category`-only row is only emitted when the category
 * carries its own description.
 * @param {{ namespaces: Object[] }} tree
 * @returns {Object[]} Flat sheet rows
 */
export function serializeTaxonomyTree(tree) {
  const rows = [];

  const withDescription = (row, description) => (
    description ? { ...row, Description: description } : row
  );

  const serializeChildren = (children, ancestorPath) => {
    children.forEach((child) => {
      if (child.children.length === 0) {
        const row = ancestorPath.length
          ? { Category: ancestorPath.join('/'), Tag: child.name }
          : { Tag: child.name };
        rows.push(withDescription(row, child.description));
        return;
      }
      const fullPath = [...ancestorPath, child.name].join('/');
      if (child.description) {
        rows.push(withDescription({ Category: fullPath }, child.description));
      }
      serializeChildren(child.children, [...ancestorPath, child.name]);
    });
  };

  (tree?.namespaces || []).forEach((namespace) => {
    rows.push(withDescription({ Namespace: namespace.name }, namespace.description));
    serializeChildren(namespace.children, []);
  });

  return rows;
}

/**
 * Flattens the tree's leaf nodes (tags) into the `{ namespace, category,
 * tag, path, description }` shape the tags plugin's picker uses, so it and
 * this app's search always agree on a tag's `path` string. Non-leaf nodes
 * (namespaces, categories) are walked into but never themselves selectable,
 * matching the picker's original behavior.
 * @param {{ namespaces: Object[] }} tree
 * @returns {Object[]} Flat list of selectable tags
 */
export function flattenTaxonomyTags(tree) {
  const out = [];

  (tree?.namespaces || []).forEach((namespace) => {
    const walk = (node, ancestorPath) => {
      if (node.children.length === 0) {
        const categoryPath = ancestorPath.join('/');
        const path = categoryPath
          ? `${namespace.name}:${categoryPath}/${node.name}`
          : `${namespace.name}/${node.name}`;
        out.push({
          namespace: namespace.name,
          category: categoryPath,
          tag: node.name,
          description: node.description,
          path,
        });
        return;
      }
      node.children.forEach((child) => walk(child, [...ancestorPath, node.name]));
    };

    namespace.children.forEach((child) => walk(child, []));
  });

  return out;
}

/**
 * Wraps flat rows in the `{ total, limit, offset, data }` envelope DA sheets
 * are saved as.
 * @param {Object[]} rows
 * @returns {Object}
 */
export function buildTaxonomySheet(rows) {
  return {
    total: rows.length, limit: rows.length, offset: 0, data: rows,
  };
}
