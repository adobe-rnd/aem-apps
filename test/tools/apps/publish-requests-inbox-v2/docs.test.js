import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const root = new URL('../../../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const inboxPath = 'tools/apps/publish-requests-inbox-v2/README.md';
const pluginPath = 'tools/plugins/request-for-publish-v2/README.md';
const inbox = read(inboxPath);
const plugin = read(pluginPath);
const home = read('README.md');

describe('I-14 v2 publish documentation', () => {
  it('uses explicit v2 routes and valid local documentation links', () => {
    [inbox, plugin].forEach((text) => {
      assert.doesNotMatch(text, /\/api\/(?!v2(?:\/|`))/);
      ['config', 'approvers', 'requests', 'requests/approve',
        'requests/reject', 'requests/withdraw'].forEach((route) => {
        assert.ok(text.includes(`/api/v2/${route}`), route);
      });
    });
    [inboxPath, pluginPath, 'README.md'].forEach((path) => {
      const text = read(path);
      [...text.matchAll(/\]\(([^)]+)\)/g)].forEach(([, target]) => {
        if (/^(?:https?:|#)/.test(target)) return;
        assert.ok(existsSync(new URL(target.split('#')[0], new URL(path, root))), target);
      });
    });
    assert.doesNotMatch(inbox, /\/tools\/publish-requests-inbox\//);
  });

  it('documents exactly the supported inbox URL parameters', () => {
    const section = inbox.split('### URL Parameters')[1]?.split('\n## ')[0];
    assert.ok(section, 'URL Parameters section');
    const params = [...section.matchAll(/^\| `([^`]+)`\s*\|/gm)]
      .map((match) => match[1]);
    assert.deepEqual(params, ['org', 'site', 'path', 'env', 'ref', 'requester']);
    assert.match(section, /`preview`.*`author`.*`comment`.*ignored/i);
  });

  it('documents explicit v2 opt-in and canonical Pattern configuration', () => {
    [inbox, plugin].forEach((text) => {
      assert.match(text, /## Opting in/);
      assert.ok(text.includes('/tools/plugins/request-for-publish-v2/request-for-publish.html'));
      assert.ok(text.includes('/tools/apps/publish-requests-inbox-v2/publish-requests-inbox'));
      assert.match(text, /\| Pattern \| Workflow \| Approvers \| CC \|/);
      assert.match(text, /`Path`.*fallback.*`Pattern`.*empty/i);
      assert.doesNotMatch(text, /v1 `Pattern`.*accepted/);
    });
    assert.ok(home.includes('tools/apps/publish-requests-inbox/publish-requests-inbox'));
    assert.ok(home.includes('tools/apps/publish-requests-inbox-v2/publish-requests-inbox'));
    assert.ok(home.includes(`${pluginPath}#opting-in`));
    assert.doesNotMatch(home, /publish-reqquest|publish-request-inbox/);
  });

  it('explains authoritative finality, stale refresh and per-path outcomes', () => {
    [inbox, plugin].forEach((text) => {
      ['isFinal', 'canApproveNow', 'stepInfo', 'final: true', '409',
        'advanced', 'completed', 'Awaiting other reviewers'].forEach((term) => {
        assert.ok(text.includes(term), term);
      });
      assert.match(text, /409[^\n]*refresh/i);
      assert.match(text, /isFinal[^\n]*authoritative/i);
    });
  });

  it('distinguishes success warnings, authorization and backend failures', () => {
    [inbox, plugin].forEach((text) => {
      assert.match(text, /emailErrors[^\n]*success[^\n]*warning/i);
      assert.match(text, /403[^\n]*authoriz/i);
      assert.match(text, /500[^\n]*502[^\n]*backend/i);
      assert.match(text, /role=page[^\n]*observer[^\n]*comment[^\n]*step[^\n]*redact/i);
    });
  });

  it('keeps live-only publication and the unresolved I-5 limitation explicit', () => {
    assert.match(inbox, /live-only/i);
    assert.match(inbox, /I-5[^\n]*unresolved/i);
    assert.match(inbox, /unpinned preview/i);
    assert.match(inbox, /worker[^\n]*persist[^\n]*baseline/i);
    assert.match(inbox, /does not[^\n]*preview before publish/i);
  });
});
