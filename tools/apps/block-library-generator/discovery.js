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
const ADMIN_ORIGIN = 'https://admin.hlx.page';
const CODE_ORIGIN = 'https://api.aem.live';
const GITHUB_ORIGIN = 'https://api.github.com';
const IDENTIFIER = /^[a-z0-9][a-z0-9._-]*$/i;
const BLOCK_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

class DiscoveryError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function validateIdentifier(value) {
  if (typeof value !== 'string' || !IDENTIFIER.test(value) || value.includes('..')) {
    throw new Error('Invalid organization or repository identifier.');
  }
}

function validateRef(ref) {
  if (typeof ref !== 'string' || !ref || /[\s?#\\]/.test(ref)
    || ref.startsWith('/') || ref.endsWith('/') || ref.includes('..') || ref.includes('//')) {
    throw new Error('Invalid code branch/reference.');
  }
}

function githubRepository(input) {
  let repository = input.trim();
  if (repository.includes('://')) {
    let url;
    try {
      url = new URL(repository);
    } catch {
      throw new Error('Invalid GitHub repository URL.');
    }
    if (url.origin !== 'https://github.com' || url.username || url.password
      || url.search || url.hash) throw new Error('Invalid public GitHub repository URL.');
    repository = url.pathname.replace(/^\/|\/$/g, '');
  }
  const parts = repository.replace(/\.git$/, '').split('/');
  if (parts.length !== 2) throw new Error('Invalid GitHub repository. Enter owner/repository.');
  parts.forEach(validateIdentifier);
  return parts.join('/');
}

function diagnostic(provider, error) {
  return {
    provider,
    message: error instanceof Error ? error.message : String(error),
    ...(typeof error?.status === 'number' ? { status: error.status } : {}),
  };
}

async function requestJSON(fetcher, url, signal, isPublic = false) {
  const timeout = AbortSignal.timeout(15000);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  requestSignal.throwIfAborted();
  const response = await fetcher(url, {
    method: 'GET',
    cache: 'no-store',
    redirect: 'error',
    signal: requestSignal,
    ...(isPublic ? {
      credentials: 'omit',
      headers: { Accept: 'application/vnd.github+json' },
    } : {}),
  });
  requestSignal.throwIfAborted();
  if (!response.ok) {
    const reasons = {
      401: 'authentication required',
      403: response.headers.get('x-ratelimit-remaining') === '0' ? 'rate limit exceeded' : 'access denied',
      404: 'not found; check repository/reference, visibility and folder availability',
      429: 'rate limit exceeded',
    };
    throw new DiscoveryError(
      `HTTP ${response.status}: ${reasons[response.status] || 'provider request failed'}.`,
      response.status,
    );
  }
  let value;
  try {
    value = await response.json();
  } catch (cause) {
    throw new Error('The inventory provider returned invalid JSON.', { cause });
  }
  requestSignal.throwIfAborted();
  return value;
}

async function listCodeFolder(daFetch, initialURL, signal) {
  const folderURL = new URL(initialURL);
  const seen = new Set();
  const children = [];
  let next = folderURL;
  while (next) {
    if (next.origin !== CODE_ORIGIN || next.pathname !== folderURL.pathname
      || next.username || next.password || next.hash || seen.has(next.href)) {
      throw new Error('Invalid or repeated code-browser pagination link.');
    }
    if (seen.size >= 100) throw new Error('Code-browser pagination exceeded 100 pages.');
    seen.add(next.href);
    // eslint-disable-next-line no-await-in-loop
    const page = await requestJSON(daFetch, next.href, signal);
    if (!Array.isArray(page?.children)) throw new Error('Invalid code-browser children listing.');
    page.children.forEach((child) => {
      if (!child || typeof child.path !== 'string' || !['file', 'folder'].includes(child.type)) {
        throw new Error('Invalid code-browser child entry.');
      }
      children.push(child);
    });
    if (page.links?.next) {
      next = new URL(page.links.next, folderURL);
    } else if (page.cursor) {
      if (typeof page.cursor !== 'string') throw new Error('Invalid code-browser pagination cursor.');
      next = new URL(folderURL);
      next.searchParams.set('cursor', page.cursor);
    } else next = null;
  }
  return children;
}

function entryFile(name, path, metadata = {}) {
  const extension = path.split('.').pop();
  if (!['js', 'css'].includes(extension) || path !== `/blocks/${name}/${name}.${extension}`) {
    return null;
  }
  return {
    path,
    extension,
    ...(typeof metadata.size === 'number' ? { size: metadata.size } : {}),
  };
}

async function codeBlocks(daFetch, coordinates, signal) {
  const { owner, repo, ref } = coordinates;
  const codeRef = ref.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  if (!codeRef) throw new Error('Invalid normalized code reference.');
  const codePrefix = `/${encodeURIComponent(owner)}/repos/${encodeURIComponent(repo)}/code/${encodeURIComponent(codeRef)}`;
  const root = `${CODE_ORIGIN}${codePrefix}/blocks/`;
  const children = await listCodeFolder(daFetch, root, signal);
  const names = new Set();
  children.filter((child) => child.type === 'folder').forEach((child) => {
    if (!child.path.startsWith(`${codePrefix}/blocks/`) || !child.path.endsWith('/')) {
      throw new Error('Code-browser folder is outside the requested inventory.');
    }
    const name = child.path.slice(`${codePrefix}/blocks/`.length, -1);
    if (BLOCK_NAME.test(name)) names.add(name);
  });
  const folders = [...names];
  const blocks = [];
  for (let start = 0; start < folders.length; start += 6) {
    // eslint-disable-next-line no-await-in-loop
    const group = await Promise.all(folders.slice(start, start + 6).map(async (name) => {
      const entries = await listCodeFolder(daFetch, `${root}${name}/`, signal);
      const files = entries.filter((child) => child.type === 'file')
        .map((child) => {
          if (!child.path.startsWith(`${codePrefix}/blocks/${name}/`)) {
            throw new Error('Code-browser file is outside the requested block folder.');
          }
          return entryFile(name, child.path.slice(codePrefix.length), child);
        }).filter(Boolean);
      return files.length ? { name, files } : null;
    }));
    blocks.push(...group.filter(Boolean));
  }
  return blocks.sort((a, b) => a.name.localeCompare(b.name));
}

async function publicBlocks(fetchPublic, repository, ref, signal) {
  const [owner, repo] = repository.split('/');
  const url = `${GITHUB_ORIGIN}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(ref)}?recursive=1`;
  const data = await requestJSON(fetchPublic, url, signal, true);
  if (!Array.isArray(data?.tree) || typeof data.sha !== 'string' || typeof data.truncated !== 'boolean') {
    throw new Error('Invalid GitHub tree response.');
  }
  if (data.truncated) throw new Error('GitHub tree is truncated; a complete inventory cannot be claimed.');
  const blocks = new Map();
  data.tree.filter((item) => item.type === 'blob' && typeof item.path === 'string').forEach((item) => {
    const parts = item.path.split('/');
    if (parts.length !== 3 || parts[0] !== 'blocks' || !BLOCK_NAME.test(parts[1])) return;
    const name = parts[1];
    const file = entryFile(name, `/${item.path}`, item);
    if (!file) return;
    if (!blocks.has(name)) blocks.set(name, { name, files: [] });
    blocks.get(name).files.push(file);
  });
  return {
    blocks: [...blocks.values()].sort((a, b) => a.name.localeCompare(b.name)),
    revision: data.sha,
  };
}

export async function discoverBlocks({
  org, site, ref = 'main', githubRepository: override = '', daFetch,
  fetchPublic = fetch, signal,
}) {
  validateIdentifier(org);
  validateIdentifier(site);
  validateRef(ref);
  const repositoryOverride = override.trim() ? githubRepository(override) : null;
  const diagnostics = [];
  let coordinates = null;
  let repository = repositoryOverride;
  try {
    const configURL = `${ADMIN_ORIGIN}/config/${encodeURIComponent(org)}/aggregated/${encodeURIComponent(site)}.json`;
    const config = await requestJSON(daFetch, configURL, signal);
    validateIdentifier(config?.code?.owner);
    validateIdentifier(config?.code?.repo);
    coordinates = { owner: config.code.owner, repo: config.code.repo, ref };
    if (!repository && config.code.source?.type !== 'byogit'
      && typeof config.code.source?.url === 'string'
      && config.code.source.url.startsWith('https://github.com/')) {
      try {
        repository = githubRepository(config.code.source.url);
      } catch (error) {
        diagnostics.push(diagnostic('github-mapping', error));
      }
    }
  } catch (error) {
    signal?.throwIfAborted();
    diagnostics.push(diagnostic('configuration', error));
  }
  if (coordinates) {
    try {
      const blocks = await codeBlocks(daFetch, coordinates, signal);
      return {
        provider: 'code-bus',
        complete: true,
        blocks,
        diagnostics,
        coordinates: { ...coordinates, githubRepository: repository },
      };
    } catch (error) {
      signal?.throwIfAborted();
      diagnostics.push(diagnostic('code-bus', error));
    }
  }
  if (repository) {
    try {
      const { blocks, revision } = await publicBlocks(fetchPublic, repository, ref, signal);
      return {
        provider: 'github',
        complete: true,
        blocks,
        revision,
        diagnostics,
        coordinates: { ...(coordinates || {}), githubRepository: repository, ref },
      };
    } catch (error) {
      signal?.throwIfAborted();
      diagnostics.push(diagnostic('github', error));
    }
  } else {
    diagnostics.push({ provider: 'github', message: 'No known GitHub repository. Supply owner/repository or enter block names manually.' });
  }
  return {
    provider: null,
    complete: false,
    blocks: [],
    diagnostics,
    coordinates: { ...(coordinates || {}), githubRepository: repository, ref },
  };
}

export function parseManualBlocks(input) {
  const names = [...new Set(input.trim().toLowerCase().split(/[\s,]+/).filter(Boolean))];
  if (!names.length) throw new Error('Enter at least one block name.');
  if (names.some((name) => !BLOCK_NAME.test(name))) {
    throw new Error('Invalid block name. Use names only (letters, digits and hyphens), without options or paths.');
  }
  return {
    provider: 'manual',
    complete: false,
    blocks: names.sort().map((name) => ({ name, files: [] })),
    diagnostics: [],
  };
}
