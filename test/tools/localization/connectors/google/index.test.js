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
import { describe as suite, it } from 'node:test';
import assert from 'node:assert/strict';
import * as google from '../../../../../tools/localization/connectors/google/index.js';
import { googleCode } from '../../../../../tools/localization/connectors/google/languages.js';
import splitHtml from '../../../../../tools/localization/connectors/google/split-html.js';

const clone = (value) => {
  const copy = structuredClone(value);
  assert.deepEqual(copy, value);
  assert.deepEqual(JSON.parse(JSON.stringify(value)), value);
  return copy;
};

const callClean = async (method, args, host) => {
  const result = await google[method](clone(args), host);
  return clone(result);
};

function fakeHost(respond = ({ body }) => ({
  status: 200, headers: {}, body: { translated: `[${body.tolang}]${body.data}` },
})) {
  const calls = [];
  return {
    calls,
    host: {
      translateProxy: async (request) => {
        calls.push(clone(request));
        return clone(await respond(request));
      },
    },
  };
}

const JOB = {
  title: 'Spring', org: 'acme', site: 'web', src: 'en-US', dests: ['fr-FR', 'zh-Hant'], options: {},
};
const ITEMS = [
  {
    id: 'a', path: '/a.html', format: 'html', content: '<p>Hello</p>',
  },
  {
    id: 'b', path: '/b.html', format: 'html', content: '<p>Bye <span translate="no">Acme</span></p>',
  },
];

suite('google connector', () => {
  it('describes itself per apiVersion 1', async () => {
    const descriptor = await callClean('describe', {});
    assert.equal(descriptor.apiVersion, 1);
    assert.equal(descriptor.name, 'google');
    assert.deepEqual(descriptor.hostServices, ['translateProxy']);
    assert.deepEqual(descriptor.capabilities.formats, ['html']);
    assert.equal(descriptor.capabilities.assets, false);
    assert.equal(descriptor.capabilities.cancel, true);
    assert.deepEqual(descriptor.options, []);
    assert.deepEqual(await callClean('isConnected', { settings: {} }), { connected: true });
    assert.deepEqual(await callClean('connect', { settings: {} }), { connected: true });
    assert.deepEqual(await callClean('listOptions', { settings: {}, key: 'x' }), { items: [] });
  });

  it('maps BCP 47 to Google codes', () => {
    assert.equal(googleCode('zh-Hans'), 'zh-CN');
    assert.equal(googleCode('zh-CN'), 'zh-CN');
    assert.equal(googleCode('zh'), 'zh-CN');
    assert.equal(googleCode('zh-Hant'), 'zh-TW');
    assert.equal(googleCode('zh-TW'), 'zh-TW');
    assert.equal(googleCode('zh-HK'), 'zh-TW');
    assert.equal(googleCode('es-419'), 'es');
    assert.equal(googleCode('pt-BR'), 'pt');
    assert.equal(googleCode('pt-PT'), 'pt-PT');
    assert.equal(googleCode('he'), 'iw');
    assert.equal(googleCode('iw-IL'), 'iw');
    assert.equal(googleCode('fr-CA'), 'fr');
    assert.equal(googleCode('nb-NO'), 'no');
    assert.equal(googleCode('xx'), null);
    assert.equal(googleCode('not a tag'), null);
  });

  it('supports differing languages or regions only', async () => {
    const check = (src, dest) => callClean('supports', { settings: {}, src, dest });
    assert.deepEqual(await check('en-US', 'fr-FR'), { ok: true });
    assert.deepEqual(await check('en-US', 'en-GB'), { ok: true });
    assert.deepEqual(await check('zh-Hans', 'zh-Hant'), { ok: true });
    assert.equal((await check('en-US', 'en-US')).ok, false);
    assert.equal((await check('en', 'xx')).ok, false);
    assert.equal((await check('bogus tag', 'fr')).ok, false);
    assert.equal(typeof (await check('en', 'xx')).reason, 'string');
  });

  it('sends, reports translated, and returns results', async () => {
    const { calls, host } = fakeHost();
    const sent = await callClean('send', { settings: {}, job: JOB, items: ITEMS }, host);
    assert.equal(sent.error, undefined);
    assert.equal(calls.length, 0);
    assert.equal(sent.jobState.srcCode, 'en');
    assert.equal(sent.jobState.langs['zh-Hant'].code, 'zh-TW');

    const status = await callClean('getStatus', { settings: {}, jobState: sent.jobState }, host);
    assert.deepEqual(status.langs, {
      'fr-FR': { status: 'translated', done: 2, total: 2 },
      'zh-Hant': { status: 'translated', done: 2, total: 2 },
    });

    const results = await callClean('getResults', { settings: {}, jobState: status.jobState, lang: 'zh-Hant' }, host);
    assert.equal(results.error, undefined);
    assert.equal(results.cursor, undefined);
    assert.deepEqual(results.items, [
      { id: 'a', content: '[zh-TW]<p>Hello</p>' },
      { id: 'b', content: '[zh-TW]<p>Bye <span translate="no">Acme</span></p>' },
    ]);
    assert.deepEqual(calls[0], {
      url: 'https://translate.da.live/translate/google/acme/web',
      method: 'POST',
      headers: {},
      body: { fromlang: 'en', tolang: 'zh-TW', data: '<p>Hello</p>' },
    });
  });

  it('pages results with a cursor and honors translateOrigin', async () => {
    const { calls, host } = fakeHost();
    const settings = { resultsPageSize: 1, translateOrigin: 'http://localhost:8788/' };
    const { jobState } = await callClean('send', { settings, job: JOB, items: ITEMS }, host);
    const first = await callClean('getResults', { settings, jobState, lang: 'fr-FR' }, host);
    assert.deepEqual(first.items.map((item) => item.id), ['a']);
    assert.equal(first.cursor, '1');
    const second = await callClean('getResults', {
      settings, jobState, lang: 'fr-FR', cursor: first.cursor,
    }, host);
    assert.deepEqual(second.items.map((item) => item.id), ['b']);
    assert.equal(second.cursor, undefined);
    assert.equal(calls[0].url, 'http://localhost:8788/translate/google/acme/web');
  });

  it('stays in progress during the simulated delay', async () => {
    const { calls, host } = fakeHost();
    const settings = { simulatedDelayMs: 60000 };
    const { jobState } = await callClean('send', { settings, job: JOB, items: ITEMS }, host);
    assert.equal(jobState.delayMs, 60000);
    const status = await callClean('getStatus', { settings, jobState }, host);
    assert.equal(status.langs['fr-FR'].status, 'in-progress');
    assert.equal(status.langs['fr-FR'].total, 2);
    const early = await callClean('getResults', { settings, jobState, lang: 'fr-FR' }, host);
    assert.equal(early.error.code, 'not-found');
    assert.equal(early.error.retryable, true);
    assert.equal(calls.length, 0);

    const elapsed = { ...jobState, sentAt: Date.now() - 60001 };
    const later = await callClean('getStatus', { settings, jobState: elapsed }, host);
    assert.equal(later.langs['fr-FR'].status, 'translated');
    const results = await callClean('getResults', { settings, jobState: elapsed, lang: 'fr-FR' }, host);
    assert.equal(results.items.length, 2);
  });

  it('reports a short real delay from Date.now', async () => {
    const { host } = fakeHost();
    const settings = { simulatedDelayMs: 30 };
    const { jobState } = await callClean('send', { settings, job: JOB, items: ITEMS }, host);
    assert.equal((await google.getStatus({ jobState })).langs['fr-FR'].status, 'in-progress');
    await new Promise((resolve) => { setTimeout(resolve, 40); });
    assert.equal((await google.getStatus({ jobState })).langs['fr-FR'].status, 'translated');
  });

  it('returns vendor errors as data', async () => {
    const { host } = fakeHost(() => ({ status: 500, headers: {}, body: 'boom' }));
    const { jobState } = await callClean('send', { settings: {}, job: JOB, items: ITEMS }, host);
    const results = await callClean('getResults', { settings: {}, jobState, lang: 'fr-FR' }, host);
    assert.equal(results.items.length, 2);
    assert.deepEqual(results.items[0].error, {
      code: 'vendor', message: 'Translate proxy returned 500', status: 500, retryable: true, itemId: 'a', lang: 'fr-FR',
    });
    assert.equal(results.error.code, 'vendor');
  });

  it('maps proxy auth, rate limits, host errors and throws', async () => {
    const run = async (respond) => {
      const { host } = fakeHost(respond);
      const { jobState } = await google.send({ settings: {}, job: JOB, items: [ITEMS[0]] });
      return (await callClean('getResults', { settings: {}, jobState, lang: 'fr-FR' }, host)).error;
    };
    assert.equal((await run(() => ({ status: 401, headers: {}, body: '' }))).code, 'not-connected');
    assert.equal((await run(() => ({ status: 429, headers: {}, body: '' }))).code, 'rate-limited');
    assert.equal((await run(() => ({ status: 200, headers: {}, body: '{}' }))).code, 'vendor');
    assert.equal((await run(() => ({
      status: 0, headers: {}, body: null, error: { code: 'network', message: 'down', retryable: true },
    }))).message, 'down');
    const thrown = await google.getResults({
      jobState: (await google.send({ job: JOB, items: ITEMS })).jobState, lang: 'fr-FR',
    }, { translateProxy: async () => { throw new Error('nope'); } });
    assert.equal(thrown.error.code, 'vendor');
    const noHost = await google.getResults({
      jobState: (await google.send({ job: JOB, items: ITEMS })).jobState, lang: 'fr-FR',
    });
    assert.equal(noHost.error.code, 'not-connected');
  });

  it('accepts JSON string bodies from the proxy', async () => {
    const { host } = fakeHost(() => ({ status: 200, headers: {}, body: '{"translated":"<p>Salut</p>"}' }));
    const { jobState } = await google.send({ settings: {}, job: JOB, items: [ITEMS[0]] });
    const results = await callClean('getResults', { settings: {}, jobState, lang: 'fr-FR' }, host);
    assert.deepEqual(results.items, [{ id: 'a', content: '<p>Salut</p>' }]);
  });

  it('splits long html into ordered chunks', async () => {
    const paragraphs = Array.from({ length: 30 }, (_, i) => `<p>${String(i).padStart(3, '0')}${'x'.repeat(400)}</p>`);
    const html = paragraphs.join('');
    const chunks = splitHtml(html, 5000);
    assert.ok(chunks.length > 1);
    assert.equal(chunks.join(''), html);
    assert.ok(chunks.every((chunk) => chunk.length <= 5000));

    const echo = ({ body }) => ({ status: 200, headers: {}, body: { translated: body.data } });
    const { calls, host } = fakeHost(echo);
    const { jobState } = await google.send({ job: JOB, items: [{ id: 'long', content: html }] });
    const results = await google.getResults({ jobState, lang: 'fr-FR' }, host);
    assert.equal(results.items[0].content, html);
    assert.equal(calls.length, chunks.length);
  });

  it('never splits inside translate="no" content', () => {
    const dnt = `<div translate="no">${'<p>keep</p>'.repeat(20)}</div>`;
    const html = `<p>${'a'.repeat(60)}</p>${dnt}<p>${'b'.repeat(60)}</p>`;
    const chunks = splitHtml(html, 100);
    assert.equal(chunks.join(''), html);
    assert.ok(chunks.includes(dnt));
  });

  it('rejects bad jobs and items as data', async () => {
    const send = (job, items) => callClean('send', { settings: {}, job, items });
    assert.equal((await send({ ...JOB, org: '' }, ITEMS)).error.code, 'unknown');
    assert.equal((await send({ ...JOB, src: 'xx' }, ITEMS)).error.code, 'unsupported-language');
    assert.equal((await send({ ...JOB, dests: [] }, ITEMS)).error.code, 'unsupported-language');
    assert.equal((await send(JOB, [])).error.code, 'not-found');
    const json = await send(JOB, [{
      id: 'j', path: '/j.json', format: 'json', content: '{}',
    }]);
    assert.deepEqual(json.error, { code: 'unsupported-format', message: 'Format json is not supported', itemId: 'j' });
    const allBad = await send({ ...JOB, dests: ['xx', 'en-US'] }, ITEMS);
    assert.equal(allBad.error.code, 'unsupported-language');
    assert.equal(allBad.jobState.langs.xx.status, 'failed');
  });

  it('fails unsupported targets per language', async () => {
    const { host } = fakeHost();
    const job = { ...JOB, dests: ['fr', 'xx'] };
    const { jobState, error } = await callClean('send', { settings: {}, job, items: ITEMS }, host);
    assert.equal(error, undefined);
    const { langs } = await callClean('getStatus', { jobState });
    assert.equal(langs.fr.status, 'translated');
    assert.equal(langs.xx.status, 'failed');
    assert.equal(langs.xx.error.code, 'unsupported-language');
    const results = await callClean('getResults', { jobState, lang: 'xx' }, host);
    assert.equal(results.error.code, 'unsupported-language');
    assert.equal((await callClean('getResults', { jobState, lang: 'de' }, host)).error.code, 'not-found');
  });

  it('cancels one or all languages', async () => {
    const { host } = fakeHost();
    const { jobState } = await callClean('send', { settings: { simulatedDelayMs: 60000 }, job: JOB, items: ITEMS }, host);
    const one = await callClean('cancel', { jobState, lang: 'fr-FR' }, host);
    assert.equal(one.langs['fr-FR'].status, 'cancelled');
    assert.equal(one.langs['zh-Hant'].status, 'in-progress');
    assert.equal(jobState.langs['fr-FR'].status, 'in-progress');
    const results = await callClean('getResults', { jobState: one.jobState, lang: 'fr-FR' }, host);
    assert.equal(results.error.code, 'cancelled');
    const all = await callClean('cancel', { jobState: one.jobState }, host);
    assert.ok(Object.values(all.langs).every((lang) => lang.status === 'cancelled'));
    assert.equal((await callClean('cancel', { jobState, lang: 'de' })).error.code, 'not-found');
  });

  it('rejects unknown job state', async () => {
    assert.equal((await callClean('getStatus', { jobState: { foo: 1 } })).error.code, 'not-found');
    assert.equal((await callClean('getResults', { jobState: null, lang: 'fr' })).error.code, 'not-found');
    assert.equal((await callClean('cancel', {})).error.code, 'not-found');
  });
});
