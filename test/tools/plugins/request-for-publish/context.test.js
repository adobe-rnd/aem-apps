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
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../../../tools/plugins/request-for-publish/request-for-publish.js', import.meta.url), 'utf8');
const entrySource = source.slice(source.indexOf('function getContextOrgSite('))
  .replace('(async function initAsDialog()', 'const dialogReady = (async function initAsDialog()')
  .replace('export default async function init(', 'async function init(');

async function fixture(mode, context) {
  const calls = [];
  const errors = [];
  const components = [];
  let Component;
  const body = { append: (cmp) => components.push(cmp), textContent: '' };
  const token = 'sdk-token';
  const entry = vm.runInNewContext(`${entrySource}; ({ init, dialogReady })`, {
    DA_SDK: Promise.resolve({ context, token }),
    LitElement: class {
      constructor() {
        this.shadowRoot = { querySelector: () => null };
      }
    },
    customElements: { define: (name, constructor) => { Component = constructor; } },
    document: {
      body: mode === 'dialog' ? body : null,
      createElement: () => new Component(),
    },
    window: {},
    console: { log: () => {}, error: (...args) => errors.push(args) },
    URLSearchParams,
    getUserEmail: async () => 'author@example.com',
    resolveWorkflowConfig: async (...args) => {
      calls.push({ action: 'config', args });
      return { approvers: ['approver@example.com'] };
    },
    checkExistingRequest: async (...args) => {
      calls.push({ action: 'existing', args });
      return null;
    },
    previewContent: async (...args) => {
      calls.push({ action: 'preview', args });
      return { success: true };
    },
    submitPublishRequest: async (...args) => {
      calls.push({ action: 'submit', args });
      return { success: true };
    },
    sampleRUM: () => {},
  });
  await entry.dialogReady;
  if (mode === 'panel') {
    const plugin = await entry.init({ context, token });
    plugin.panel.render(body);
  }
  return {
    component: components[0], calls, errors, body,
  };
}

['dialog', 'panel'].forEach((mode) => {
  describe(`${mode} SDK context`, () => {
    it('normalizes .html before lookups, preview, diff and request submission', async () => {
      const context = {
        org: 'example', site: 'website', path: '/news/article.html', view: 'edit', ref: 'main',
      };
      const { component, calls, errors } = await fixture(mode, context);
      assert.equal(component.context.path, '/news/article');
      assert.equal(component.context.view, 'edit');
      assert.equal(component.context.ref, 'main');
      assert.equal(context.path, '/news/article.html');
      await component.init();
      await component.handleSubmit();
      assert.equal(calls.find((call) => call.action === 'config').args[0], '/news/article');
      assert.equal(calls.find((call) => call.action === 'existing').args[2], '/news/article');
      assert.equal(calls.find((call) => call.action === 'preview').args[2], '/news/article');
      assert.equal(new URL(component.diffUrl).searchParams.get('path'), '/news/article');
      const [request, token] = calls.find((call) => call.action === 'submit').args;
      assert.equal(request.path, '/news/article');
      assert.equal(request.previewUrl, 'https://main--website--example.aem.page/news/article');
      assert.equal(token, 'sdk-token');
      assert.equal(errors.length, 0);
    });

    it('preserves extensionless paths and supports both site and repo context', async () => {
      await Promise.all([{ repo: 'website' }, { site: 'website', repo: 'legacy' }].map(async (fields) => {
        const { component } = await fixture(mode, {
          org: 'example', ...fields, path: '/news/article',
        });
        assert.equal(component.context.site, 'website');
        assert.equal(component.contentPath, '/news/article');
        assert.equal(component.previewUrl, 'https://main--website--example.aem.page/news/article');
      }));
    });

    it('keeps normalized index paths for Admin and maps preview links as before', async () => {
      await Promise.all([
        ['/index.html', '/index', ''],
        ['/news/index.html', '/news/index', '/news'],
      ].map(async ([path, contentPath, previewPath]) => {
        const { component, calls } = await fixture(mode, {
          org: 'example', site: 'website', path,
        });
        await component.init();
        await component.handleSubmit();
        assert.equal(calls.find((call) => call.action === 'preview').args[2], contentPath);
        assert.equal(calls.find((call) => call.action === 'submit').args[0].path, contentPath);
        assert.equal(component.previewUrl, `https://main--website--example.aem.page${previewPath}`);
      }));
    });

    it('preserves non-HTML file extensions', async () => {
      const { component } = await fixture(mode, {
        org: 'example', site: 'website', path: '/docs/brochure.pdf',
      });
      assert.equal(component.contentPath, '/docs/brochure.pdf');
    });
  });
});
