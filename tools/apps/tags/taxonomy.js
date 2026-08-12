/**
 * Taxonomy sheet reading + tree model, shared by this app and
 * `tools/plugins/tags/tags.js` (which imports `resolveTaxonomyLocation`,
 * `fetchTaxonomySheet`, `parseTaxonomyTree`, and `flattenTaxonomyTags`
 * directly from here) — one canonical implementation of the taxonomy.json
 * contract instead of two copies drifting apart.
 *
 * `parseTaxonomyTree` + `serializeTaxonomyTree` convert between
 * `taxonomy.json`'s flat sheet rows and an in-memory tree the editor UI can
 * manipulate directly. Round-tripping through them must always produce a
 * sheet the tags plugin parses identically.
 *
 * The tree groups each namespace/category's direct tags together ahead of
 * its sub-categories (rather than allowing tags and categories to interleave
 * in arbitrary order). That's how every existing sheet in this repo is
 * already authored, and it keeps serialization simple: a header row only
 * ever needs to be emitted once per namespace/category, immediately before
 * its content, with no need to "return" to a parent context afterward.
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

/**
 * Finds (or creates) a namespace node by name, preserving first-seen order.
 * @param {Object[]} namespaces
 * @param {Map<string, Object>} byName
 * @param {string} name
 * @returns {Object} The namespace node
 */
function ensureNamespace(namespaces, byName, name) {
  let ns = byName.get(name);
  if (!ns) {
    ns = { name, tags: [], categories: [] };
    byName.set(name, ns);
    namespaces.push(ns);
  }
  return ns;
}

/**
 * Walks (creating as needed) the chain of nested category nodes described by
 * a `/`-joined category path, returning the deepest one.
 * @param {Object} namespace Namespace node to walk/create categories under
 * @param {string} categoryPath e.g. `catlev1/catlev2`
 * @returns {Object} The deepest category node in the path
 */
function ensureCategoryPath(namespace, categoryPath) {
  const parts = categoryPath.split('/').map((part) => part.trim()).filter(Boolean);
  let siblings = namespace.categories;
  let node = null;
  parts.forEach((part) => {
    node = siblings.find((cat) => cat.name === part);
    if (!node) {
      node = { name: part, tags: [], categories: [] };
      siblings.push(node);
    }
    siblings = node.categories;
  });
  return node;
}

/**
 * Parses `taxonomy.json`'s flat `data` rows into a namespace/category tree.
 * Follows the same header-inheritance rule as `tags.js`'s `parseTaxonomy`: a
 * `Namespace` row resets the current category, a `Category` row (which may
 * contain nested `/`-separated levels) sets where following `Tag` rows
 * attach, until the next header row changes it.
 * @param {Object[]} rows Raw `taxonomy.json` `data` rows
 * @returns {{ namespaces: Object[] }} The parsed tree
 */
export function parseTaxonomyTree(rows = []) {
  const namespaces = [];
  const byName = new Map();
  let currentNamespace = null;
  let currentCategory = null;

  rows.forEach((row) => {
    if (row.Tag) {
      const target = currentCategory || currentNamespace;
      if (target) target.tags.push({ tag: row.Tag, description: row.Description || '' });
      return;
    }
    if (row.Namespace) {
      currentNamespace = ensureNamespace(namespaces, byName, row.Namespace);
      currentCategory = null;
    }
    if (row.Category && currentNamespace) {
      currentCategory = ensureCategoryPath(currentNamespace, row.Category);
    }
  });

  return { namespaces };
}

/**
 * Serializes a namespace/category tree back into `taxonomy.json`'s flat
 * `data` rows, in the format `parseTaxonomy`/`parseTaxonomyTree` expect.
 * @param {{ namespaces: Object[] }} tree
 * @returns {Object[]} Flat sheet rows
 */
export function serializeTaxonomyTree(tree) {
  const rows = [];

  const tagRow = (tag) => {
    const row = { Tag: tag.tag };
    if (tag.description) row.Description = tag.description;
    return row;
  };

  const emitCategory = (category, ancestorPath) => {
    const fullPath = [...ancestorPath, category.name].join('/');
    rows.push({ Category: fullPath });
    category.tags.forEach((tag) => rows.push(tagRow(tag)));
    category.categories.forEach((sub) => emitCategory(sub, [...ancestorPath, category.name]));
  };

  (tree?.namespaces || []).forEach((namespace) => {
    rows.push({ Namespace: namespace.name });
    namespace.tags.forEach((tag) => rows.push(tagRow(tag)));
    namespace.categories.forEach((category) => emitCategory(category, []));
  });

  return rows;
}

/**
 * Flattens the tree into the same `{ namespace, category, tag, path,
 * description }` shape `tags.js`'s `parseTaxonomy` produces, so the search
 * tag-picker and the tags plugin always agree on a tag's `path` string.
 * @param {{ namespaces: Object[] }} tree
 * @returns {Object[]} Flat list of selectable tags
 */
export function flattenTaxonomyTags(tree) {
  const out = [];

  (tree?.namespaces || []).forEach((namespace) => {
    namespace.tags.forEach((tag) => {
      out.push({
        namespace: namespace.name,
        category: '',
        tag: tag.tag,
        description: tag.description,
        path: `${namespace.name}/${tag.tag}`,
      });
    });

    const walk = (category, ancestorPath) => {
      const categoryPath = [...ancestorPath, category.name].join('/');
      category.tags.forEach((tag) => {
        out.push({
          namespace: namespace.name,
          category: categoryPath,
          tag: tag.tag,
          description: tag.description,
          path: `${namespace.name}:${categoryPath}/${tag.tag}`,
        });
      });
      category.categories.forEach((sub) => walk(sub, [...ancestorPath, category.name]));
    };

    namespace.categories.forEach((category) => walk(category, []));
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
