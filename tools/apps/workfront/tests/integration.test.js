import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { normalizeContext, putBriefInChat } from '../host.js';

test('static icons use mapped local Spectrum SVGs without an icon runtime', async () => {
  const [html, css, app] = await Promise.all(['index.html', 'styles.css', 'app.js']
    .map((name) => readFile(new URL(`../${name}`, import.meta.url), 'utf8')));
  const mappings = new Set([...css.matchAll(/\[data-icon="([^"]+)"\]/g)]
    .map((match) => match[1]));
  const icons = [...html.matchAll(/data-icon="([^"]+)"/g)];
  assert.ok(icons.length > 0);
  icons.forEach((match) => assert.ok(mappings.has(match[1]), `Missing icon: ${match[1]}`));
  assert.doesNotMatch(html + app + css, /lucide|createIcons/);
  const sources = [...css.matchAll(/url\('([^']+\.svg)'\)/g)];
  assert.ok(sources.length > 0);
  await Promise.all(sources.map(async (match) => {
    assert.match(match[1], /^\.\/assets\/icons\/S2_Icon_[A-Za-z]+_20_N\.svg$/);
    const svg = await readFile(new URL(`../${match[1]}`, import.meta.url), 'utf8');
    assert.match(svg, /<svg\b/);
    assert.match(svg, /viewBox="0 0 20 20"/);
    assert.doesNotMatch(svg, /<script\b|<foreignObject\b|\bon\w+\s*=|(?:href|src)\s*=/i);
  }));
});

test('EW context uses the exact organization, repository and document path', () => {
  const context = normalizeContext({ org: 'northstar', repo: 'website', path: '/collections/fall.html' });
  assert.equal(context.siteId, 'northstar/website');
  assert.equal(context.path, '/collections/fall.html');
  assert.equal(context.url, 'https://da.live/canvas#/northstar/website/collections/fall');
  assert.equal(context.title, 'Fall');
});

test('missing host context is not replaced with a guessed page', () => {
  assert.equal(normalizeContext({}), null);
  assert.equal(normalizeContext({ org: 'northstar', repo: 'website' }).url, '');
});

test('chat uses setPrompt without auto-sending or inserting text into the page', () => {
  const calls = [];
  putBriefInChat({
    showPanel: (name) => calls.push(name),
    setPrompt: (text, options) => calls.push({ text, options }),
    sendText: () => assert.fail('Must not insert into the editor'),
  }, 'A project brief');
  assert.deepEqual(calls, [{ text: 'A project brief', options: { autoSend: false } }, 'chat']);
  assert.throws(() => putBriefInChat({}, 'A brief'), /unavailable/);
});
