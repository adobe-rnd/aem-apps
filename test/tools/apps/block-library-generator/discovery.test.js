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
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { discoverBlocks, parseManualBlocks } from '../../../../tools/apps/block-library-generator/discovery.js';

const configURL = 'https://admin.hlx.page/config/test-org/aggregated/test-site.json';
const root = 'https://api.aem.live/code-owner/repos/code-repo/code/main/blocks/';
const codePath = '/code-owner/repos/code-repo/code/main/blocks/';
const config = {
  code: { owner: 'code-owner', repo: 'code-repo', source: { url: 'https://github.com/git-owner/git-repo' } },
};
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
const listing = (children, next) => ({ children, links: next ? { next } : {} });
const folder = (name) => ({ type: 'folder', path: `${codePath}${name}/` });
const file = (name, ext) => ({ type: 'file', path: `${codePath}${name}/${name}.${ext}`, size: 0 });

function fixture(routes = {}, publicRoutes = {}) {
  const authenticated = [];
  const publicCalls = [];
  return {
    authenticated,
    publicCalls,
    options: {
      org: 'test-org',
      site: 'test-site',
      ref: 'main',
      daFetch: async (url, options) => {
        authenticated.push({ url, options });
        return routes[url] ? routes[url]() : new Response(null, { status: 404 });
      },
      fetchPublic: async (url, options) => {
        publicCalls.push({ url, options });
        return publicRoutes[url] ? publicRoutes[url]() : new Response(null, { status: 404 });
      },
    },
  };
}

describe('synced-code discovery', () => {
  it('uses configured code coordinates, without a ping gate or GitHub requests', async () => {
    const data = fixture({
      [configURL]: () => json(config),
      [root]: () => json(listing([folder('hero'), folder('cards'), folder('helpers')])),
      [`${root}hero/`]: () => json(listing([file('hero', 'js')])),
      [`${root}cards/`]: () => json(listing([file('cards', 'css'), file('cards', 'js')])),
      [`${root}helpers/`]: () => json(listing([])),
    });
    const result = await discoverBlocks(data.options);
    assert.equal(result.provider, 'code-bus');
    assert.equal(result.complete, true);
    assert.deepEqual(result.blocks.map((block) => block.name), ['cards', 'hero']);
    assert.equal(result.blocks[0].files.length, 2);
    assert.equal(result.blocks[1].files[0].size, 0);
    assert.equal(result.blocks[1].files[0].path, '/blocks/hero/hero.js');
    assert.equal(result.coordinates.githubRepository, 'git-owner/git-repo');
    assert.equal(data.publicCalls.length, 0);
    assert.ok(data.authenticated.every(({ options }) => options.method === 'GET'));
    assert.ok(data.authenticated.every(({ url }) => !url.includes('/ping')));
  });

  it('follows pagination for the root and block folders', async () => {
    const nextRoot = `${root}?cursor=root-2`;
    const nextCard = `${root}cards/?cursor=card-2`;
    const data = fixture({
      [configURL]: () => json(config),
      [root]: () => json(listing([folder('cards')], nextRoot)),
      [nextRoot]: () => json(listing([folder('hero')])),
      [`${root}cards/`]: () => json({ children: [file('cards', 'css')], cursor: 'card-2' }),
      [nextCard]: () => json(listing([file('cards', 'js')])),
      [`${root}hero/`]: () => json(listing([file('hero', 'css')])),
    });
    const result = await discoverBlocks(data.options);
    assert.equal(result.provider, 'code-bus');
    assert.deepEqual(result.blocks.map((block) => block.name), ['cards', 'hero']);
    assert.equal(result.blocks[0].files.length, 2);
    assert.ok(data.authenticated.some(({ url }) => url === nextRoot));
    assert.ok(data.authenticated.some(({ url }) => url === nextCard));
  });

  it('treats a valid empty listing as success, not a fallback trigger', async () => {
    const data = fixture({
      [configURL]: () => json(config),
      [root]: () => json(listing([])),
    });
    const result = await discoverBlocks(data.options);
    assert.equal(result.provider, 'code-bus');
    assert.deepEqual(result.blocks, []);
    assert.equal(data.publicCalls.length, 0);
  });

  it('does not send credentials to hostile pagination URLs', async () => {
    const data = fixture({
      [configURL]: () => json(config),
      [root]: () => json(listing([], 'https://untrusted.example/steal')),
    });
    const result = await discoverBlocks(data.options);
    assert.equal(result.provider, null);
    assert.match(result.diagnostics.map((entry) => entry.message).join(' '), /pagination/i);
    assert.ok(data.authenticated.every(({ url }) => !url.includes('untrusted')));
  });

  it('does not accept partial code inventories after a block-folder access failure', async () => {
    const data = fixture({
      [configURL]: () => json(config),
      [root]: () => json(listing([folder('cards')])),
      [`${root}cards/`]: () => new Response(null, { status: 403 }),
    });
    const result = await discoverBlocks(data.options);
    assert.equal(result.provider, null);
    assert.equal(result.complete, false);
    assert.deepEqual(result.blocks, []);
    assert.ok(result.diagnostics.some((entry) => entry.status === 403));
  });

  it('uses platform-normalized code refs while retaining the authored branch', async () => {
    const url = root.replace('/main/', '/feature-foo/');
    const data = fixture({
      [configURL]: () => json(config),
      [url]: () => json(listing([])),
    });
    const result = await discoverBlocks({ ...data.options, ref: 'feature/F\u00f3\u00f3' });
    assert.equal(result.provider, 'code-bus');
    assert.equal(result.coordinates.ref, 'feature/F\u00f3\u00f3');
    assert.equal(data.authenticated[1].url, url);
  });

  it('rejects looping pagination and malformed provider responses visibly', async () => {
    await Promise.all([
      listing([], root),
      { children: 'not-an-array' },
      listing([{ type: 'folder', path: '/outside/cards/' }]),
    ].map(async (value) => {
      const data = fixture({
        [configURL]: () => json(config),
        [root]: () => json(value),
      });
      const result = await discoverBlocks(data.options);
      assert.equal(result.provider, null);
      assert.ok(result.diagnostics.some((entry) => entry.provider === 'code-bus'));
      assert.ok(data.authenticated.every(({ url }) => url.startsWith('https://admin.hlx.page/')
        || url.startsWith(root)));
    }));
  });
});

describe('public GitHub fallback', () => {
  const githubURL = 'https://api.github.com/repos/git-owner/git-repo/git/trees/main?recursive=1';
  const tree = {
    sha: 'revision',
    truncated: false,
    tree: [
      { type: 'blob', path: 'blocks/cards/cards.css', size: 200 },
      { type: 'blob', path: 'blocks/cards/cards.js', size: 0 },
      { type: 'blob', path: 'blocks/fragment/fragment.js', size: 30 },
      { type: 'blob', path: 'blocks/cards/helpers/util.js', size: 40 },
      { type: 'blob', path: 'node_modules/blocks/other/other.js', size: 1 },
    ],
  };

  it('shows the code-browser failure and uses unauthenticated public fetch only', async () => {
    const data = fixture({
      [configURL]: () => json(config),
      [root]: () => new Response(null, { status: 403 }),
    }, { [githubURL]: () => json(tree) });
    const result = await discoverBlocks(data.options);
    assert.equal(result.provider, 'github');
    assert.equal(result.revision, 'revision');
    assert.deepEqual(result.blocks.map((block) => block.name), ['cards', 'fragment']);
    assert.ok(result.diagnostics.some((entry) => entry.provider === 'code-bus' && entry.status === 403));
    const [{ url, options }] = data.publicCalls;
    assert.equal(url, githubURL);
    assert.equal(options.credentials, 'omit');
    assert.ok(!Object.keys(options.headers).some((key) => key.toLowerCase() === 'authorization'));
    assert.ok(data.authenticated.every((call) => !call.url.includes('api.github.com')));
  });

  it('requires manual input rather than claiming a truncated tree is complete', async () => {
    const data = fixture({
      [configURL]: () => json(config),
    }, { [githubURL]: () => json({ ...tree, truncated: true }) });
    const result = await discoverBlocks(data.options);
    assert.equal(result.provider, null);
    assert.equal(result.complete, false);
    assert.match(result.diagnostics.at(-1).message, /truncated/i);
  });

  it('allows an explicit public repository when configuration is unavailable', async () => {
    const data = fixture({
      [configURL]: () => new Response(null, { status: 403 }),
    }, { [githubURL]: () => json(tree) });
    const result = await discoverBlocks({
      ...data.options, githubRepository: 'https://github.com/git-owner/git-repo',
    });
    assert.equal(result.provider, 'github');
    assert.ok(result.diagnostics.some((entry) => entry.provider === 'configuration' && entry.status === 403));
    assert.equal(data.authenticated.length, 1);
  });

  it('does not guess a repository from DA org/site after configuration failure', async () => {
    const data = fixture();
    const result = await discoverBlocks(data.options);
    assert.equal(result.provider, null);
    assert.equal(data.publicCalls.length, 0);
    assert.match(result.diagnostics.at(-1).message, /repository/i);
  });

  it('preserves private/missing and rate-limit errors for manual fallback', async () => {
    await Promise.all([404, 429].map(async (status) => {
      const data = fixture({
        [configURL]: () => json(config),
      }, { [githubURL]: () => new Response(null, { status }) });
      const result = await discoverBlocks(data.options);
      assert.equal(result.provider, null);
      assert.ok(result.diagnostics.some((entry) => entry.provider === 'github' && entry.status === status));
    }));
  });
});

describe('discovery boundaries', () => {
  it('rejects invalid target/ref/repository input before network access', async () => {
    const data = fixture();
    await Promise.all([
      { org: '../elsewhere' },
      { ref: '../main' },
      { githubRepository: 'https://untrusted.example/owner/repo' },
    ].map(async (override) => {
      await assert.rejects(discoverBlocks({ ...data.options, ...override }), /invalid/i);
    }));
    assert.equal(data.authenticated.length, 0);
    assert.equal(data.publicCalls.length, 0);
  });

  it('aborts without falling back to another provider', async () => {
    const controller = new AbortController();
    const data = fixture({
      [configURL]: () => {
        controller.abort();
        return json(config);
      },
    });
    await assert.rejects(discoverBlocks({ ...data.options, signal: controller.signal }), /abort/i);
    assert.equal(data.authenticated.length, 1);
    assert.equal(data.publicCalls.length, 0);
  });

  it('normalizes and deduplicates manual names without claiming source verification', () => {
    const result = parseManualBlocks('Cards, columns\nhero cards');
    assert.equal(result.provider, 'manual');
    assert.equal(result.complete, false);
    assert.deepEqual(result.blocks.map((block) => block.name), ['cards', 'columns', 'hero']);
    assert.ok(result.blocks.every((block) => block.files.length === 0));
  });

  it('rejects empty manual input, options, paths and traversal', () => {
    ['', 'cards (blue)', '../hero', 'blocks/cards', 'hero.css'].forEach((input) => {
      assert.throws(() => parseManualBlocks(input), /invalid|enter/i);
    });
  });
});
