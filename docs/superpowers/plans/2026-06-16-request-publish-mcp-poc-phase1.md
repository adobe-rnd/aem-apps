# Request-Publish MCP — Phase 1 (POC) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the existing publish-workflow as an MCP server at `publish-requests-worker/mcp` so it can be driven agentically from da-nx Chat mode against **production `agent.da.live`**, with zero da-agent changes.

**Architecture:** Add a stateless MCP (JSON-RPC over Streamable HTTP) endpoint to the existing `publish-requests` Cloudflare Worker. The endpoint authenticates callers with an MCP↔worker **shared secret** (forwarded by da-agent as a configured header) and performs all DA Admin / Helix Admin / email operations using a **service credential** (a dev IMS token in a worker secret). The workflow logic (specificity matching, DL-group expansion, sheet I/O, publish, notifications) is ported from the inbox app's `api.js`. A `request-publish` skill + agent preset + an `mcp-servers` config row register it into a **test site**. No per-user authorization and no approval card in this phase (mitigated by verbal-confirm skill instructions + test-site blast radius) — both are restored in Phase 2.

**Tech Stack:** Cloudflare Workers (plain ES modules, no TypeScript), `vitest` + `@cloudflare/vitest-pool-workers`, `jose` (already present), AWS SES / Gmail / custom-API email (already present). Spec: [docs/superpowers/specs/2026-06-16-request-publish-agentic-chat-design.md](../specs/2026-06-16-request-publish-agentic-chat-design.md).

All paths below are relative to the worker repo: `cloudadoption/codebase/publish-requests-worker/`.

---

## Conventions used by every task

- **Module style:** ES modules, named exports, matching the existing `src/` files. Lint with `npm run lint` (Airbnb base) before each commit.
- **Test command:** `npm test` (vitest). Run a single file with `npx vitest run test/mcp/<file>.test.js`.
- **No network in unit tests:** MCP functions receive `env` as a parameter and call `globalThis.fetch`. Tests pass a fake `env` and stub fetch with `vi.stubGlobal('fetch', vi.fn())`.
- **Constants** (define once in `src/mcp/constants.js`, Task 1):
  - `DA_ADMIN = 'https://admin.da.live'`
  - `ADMIN_HLX = 'https://admin.hlx.page'`
  - `REQUESTS_SHEET_PATH = '/.da/publish-workflow-requests.json'`
  - `REQUEST_COLUMNS = ['requester', 'approver', 'path', 'comment', 'status', 'created']`
  - `MCP_PROTOCOL_VERSION = '2025-03-26'`

---

## File structure (created/modified)

```
src/
  index.js                 MODIFY  — route POST/DELETE /mcp before validateDAToken
  email.js                 CREATE  — extracted email + registration + templates (from index.js)
  mcp/
    constants.js           CREATE  — shared constants
    transport.js           CREATE  — stateless JSON-RPC dispatch (initialize/list/call)
    auth.js                CREATE  — shared-secret check
    da-client.js           CREATE  — service-token DA source/config client
    publish-client.js      CREATE  — service-token Helix Admin publish client
    workflow.js            CREATE  — ported pure logic (matching, expansion, sheet edits)
    tools.js               CREATE  — the 6 tool definitions + handlers + registry
    index.js               CREATE  — handleMcpRequest(request, env): auth + dispatch
test/mcp/
    transport.test.js      CREATE
    da-client.test.js      CREATE
    workflow.test.js       CREATE
    publish-client.test.js CREATE
    tools.read.test.js     CREATE
    tools.request.test.js  CREATE
    tools.approve.test.js  CREATE
mcp-assets/                CREATE  — canonical source of site-installed content
    skill.md               CREATE  — request-publish skill (installed to test site .da/skills/)
    agent-preset.json      CREATE  — publish-workflow preset (installed to .da/agents/)
    mcp-servers-row.md     CREATE  — copy/paste registration instructions
wrangler.toml              MODIFY  — document new secrets
```

---

## Task 1: MCP transport skeleton + `/mcp` route + shared-secret auth

**Files:**
- Create: `src/mcp/constants.js`, `src/mcp/auth.js`, `src/mcp/transport.js`, `src/mcp/index.js`
- Modify: `src/index.js` (add route), `wrangler.toml` (document secrets)
- Test: `test/mcp/transport.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/mcp/transport.test.js
import { describe, it, expect } from 'vitest';
import { handleMcpRequest } from '../../src/mcp/index.js';

const ENV = { MCP_SHARED_SECRET: 'sekret', PUBLISH_WORKFLOW_SERVICE_TOKEN: 'svc' };

function mcpRequest(body, headers = { 'x-mcp-secret': 'sekret' }) {
  return new Request('https://w.dev/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('MCP transport', () => {
  it('rejects a missing/wrong shared secret with 401', async () => {
    const res = await handleMcpRequest(mcpRequest({ jsonrpc: '2.0', id: 1, method: 'initialize' }, {}), ENV);
    expect(res.status).toBe(401);
  });

  it('answers initialize with the protocol version', async () => {
    const res = await handleMcpRequest(mcpRequest({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }), ENV);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.result.protocolVersion).toBe('2025-03-26');
    expect(json.result.capabilities.tools).toBeDefined();
  });

  it('returns 202 for the initialized notification (no id)', async () => {
    const res = await handleMcpRequest(mcpRequest({ jsonrpc: '2.0', method: 'notifications/initialized' }), ENV);
    expect(res.status).toBe(202);
  });

  it('lists tools', async () => {
    const res = await handleMcpRequest(mcpRequest({ jsonrpc: '2.0', id: 2, method: 'tools/list' }), ENV);
    const json = await res.json();
    expect(Array.isArray(json.result.tools)).toBe(true);
  });

  it('errors on an unknown method with -32601', async () => {
    const res = await handleMcpRequest(mcpRequest({ jsonrpc: '2.0', id: 3, method: 'bogus' }), ENV);
    const json = await res.json();
    expect(json.error.code).toBe(-32601);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/mcp/transport.test.js`
Expected: FAIL — `Cannot find module '../../src/mcp/index.js'`.

- [ ] **Step 3: Create the constants**

```js
// src/mcp/constants.js
export const DA_ADMIN = 'https://admin.da.live';
export const ADMIN_HLX = 'https://admin.hlx.page';
export const REQUESTS_SHEET_PATH = '/.da/publish-workflow-requests.json';
export const REQUEST_COLUMNS = ['requester', 'approver', 'path', 'comment', 'status', 'created'];
export const MCP_PROTOCOL_VERSION = '2025-03-26';
```

- [ ] **Step 4: Create the shared-secret auth**

```js
// src/mcp/auth.js
/**
 * The MCP endpoint is called by da-agent, which forwards a configured header
 * (x-mcp-secret) from the site's mcp-servers config. POC-only auth: a shared
 * secret. Phase 2 replaces this with the forwarded per-user IMS token.
 * @returns {boolean} true when the caller presented the correct secret
 */
export function isMcpCallerAuthorized(request, env) {
  const provided = request.headers.get('x-mcp-secret');
  return Boolean(env.MCP_SHARED_SECRET) && provided === env.MCP_SHARED_SECRET;
}
```

- [ ] **Step 5: Create the transport (stateless JSON-RPC dispatch)**

```js
// src/mcp/transport.js
import { MCP_PROTOCOL_VERSION } from './constants.js';

function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}
function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

/**
 * Dispatch one JSON-RPC message. `tools` is a registry:
 * { definitions: [{name, description, inputSchema, annotations}], handlers: { name: async (args, env) => result } }
 * Returns { status, body } where body is null for notifications.
 */
export async function dispatchRpc(message, env, tools) {
  const { id, method, params } = message ?? {};

  // Notifications have no id and expect 202 with no body.
  if (id === undefined || id === null) {
    return { status: 202, body: null };
  }

  if (method === 'initialize') {
    return {
      status: 200,
      body: rpcResult(id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'publish-workflow', version: '1.0.0' },
      }),
    };
  }

  if (method === 'tools/list') {
    return { status: 200, body: rpcResult(id, { tools: tools.definitions }) };
  }

  if (method === 'tools/call') {
    const name = params?.name;
    const args = params?.arguments ?? {};
    const handler = tools.handlers[name];
    if (!handler) {
      return { status: 200, body: rpcError(id, -32602, `Unknown tool: ${name}`) };
    }
    try {
      const result = await handler(args, env);
      return {
        status: 200,
        body: rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(result) }] }),
      };
    } catch (e) {
      return {
        status: 200,
        body: rpcResult(id, { content: [{ type: 'text', text: String(e.message || e) }], isError: true }),
      };
    }
  }

  return { status: 200, body: rpcError(id, -32601, `Method not found: ${method}`) };
}
```

- [ ] **Step 6: Create the MCP request handler**

```js
// src/mcp/index.js
import { isMcpCallerAuthorized } from './auth.js';
import { dispatchRpc } from './transport.js';
import { TOOLS } from './tools.js';

/**
 * Entry point for POST/DELETE /mcp. Stateless: no session is persisted.
 */
export async function handleMcpRequest(request, env) {
  if (request.method === 'DELETE') {
    return new Response(null, { status: 200 });
  }
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }
  if (!isMcpCallerAuthorized(request, env)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let message;
  try {
    message = await request.json();
  } catch {
    return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { status, body } = await dispatchRpc(message, env, TOOLS);
  if (body === null) return new Response(null, { status });
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
```

- [ ] **Step 7: Create a minimal tools registry so Task 1 can run**

(Real tools are added in Tasks 7–9. Start empty.)

```js
// src/mcp/tools.js
export const TOOLS = {
  definitions: [],
  handlers: {},
};
```

- [ ] **Step 8: Wire the `/mcp` route into the worker (before token validation)**

In `src/index.js`, add the import at the top of the import block:

```js
import { handleMcpRequest } from './mcp/index.js';
```

Then, inside `fetch`, immediately after the `if (pathname === '/' && method === 'GET')` block and **before** the `try { const authResult = await validateDAToken(request); ... }` block, add:

```js
    // MCP endpoint uses its own (shared-secret) auth — not the DA user JWT.
    if (pathname === '/mcp') {
      return handleMcpRequest(request, env);
    }
```

- [ ] **Step 9: Document new secrets in wrangler.toml**

Append to the secrets comment block in `wrangler.toml`:

```toml
#
# MCP (POC) secrets:
#   npx wrangler secret put MCP_SHARED_SECRET               # shared secret echoed by da-agent via x-mcp-secret header
#   npx wrangler secret put PUBLISH_WORKFLOW_SERVICE_TOKEN  # dev IMS token with content-write on the TEST org/site
```

- [ ] **Step 10: Run the test to verify it passes**

Run: `npx vitest run test/mcp/transport.test.js`
Expected: PASS (5 tests).

- [ ] **Step 11: Lint and commit**

```bash
npm run lint
git add src/mcp/ src/index.js wrangler.toml test/mcp/transport.test.js
git commit -m "feat(mcp): add /mcp endpoint with shared-secret auth and JSON-RPC transport"
```

---

## Task 2: Extract email + registration + templates into `src/email.js`

`src/index.js` is 742 lines and the MCP tools need `sendEmail` / `getRegistrationConfig` / `getTemplates` without creating an import cycle (index.js → mcp → index.js). Extract them into a shared module. Behavior is unchanged, so existing tests must still pass.

**Files:**
- Create: `src/email.js`
- Modify: `src/index.js`
- Test: existing `test/index.test.js`, `test/utils.test.js` (must still pass)

- [ ] **Step 1: Run existing tests to capture the green baseline**

Run: `npm test`
Expected: PASS (record the count).

- [ ] **Step 2: Create `src/email.js` by moving code from `index.js`**

Move these out of `src/index.js` into `src/email.js` **verbatim**, and add `export` to each: the template imports + `TEMPLATE_SETS` + `getTemplates`; `getRegistrationConfig`; `summarizeErrorBody`; `sendEmailDefault`; `getGmailAccessToken`; `sendEmailGmail`; `sendEmailCustomAPI`; `sendEmail`. Keep their bodies identical. `src/email.js` must import what those functions use from `./utils.js`:

```js
// src/email.js — top of file
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import defaultApproval from './templates/default/approval-request.html';
import defaultRejection from './templates/default/rejection.html';
import defaultPublished from './templates/default/published.html';
import wsuApproval from './templates/wsu-do--westernsydney/approval-request.html';
import wsuRejection from './templates/wsu-do--westernsydney/rejection.html';
import wsuPublished from './templates/wsu-do--westernsydney/published.html';
import sagarsaneApproval from './templates/sagarsane--gw-2025-playground/approval-request.html';
import sagarsaneRejection from './templates/sagarsane--gw-2025-playground/rejection.html';
import sagarsanePublished from './templates/sagarsane--gw-2025-playground/published.html';
import {
  toRecipientObject, toRecipientEmail, toRFC2822Address, sanitizeHeaderValue,
} from './utils.js';

export const TEMPLATE_SETS = { /* ...moved verbatim... */ };
export function getTemplates(org, site) { /* ...moved verbatim... */ }
export async function getRegistrationConfig(env, org, site) { /* ...moved verbatim... */ }
export function summarizeErrorBody(body) { /* ...moved verbatim... */ }
async function sendEmailDefault(env, params) { /* ...moved verbatim... */ }
async function getGmailAccessToken(env) { /* ...moved verbatim... */ }
async function sendEmailGmail(env, params) { /* ...moved verbatim... */ }
async function sendEmailCustomAPI(registration, params) { /* ...moved verbatim... */ }
export async function sendEmail(env, params, registration) { /* ...moved verbatim... */ }
```

- [ ] **Step 3: Update `src/index.js` to import the moved functions**

Remove the moved code and the now-unused template/SES imports from `src/index.js`. Add:

```js
import {
  getTemplates, getRegistrationConfig, sendEmail, summarizeErrorBody,
} from './email.js';
```

Keep `export { summarizeErrorBody }` working if `test/index.test.js` imports it from `index.js` — re-export it: `export { summarizeErrorBody } from './email.js';` (check the test's import path; if the test imports `summarizeErrorBody` from `../src/index.js`, the re-export preserves it).

- [ ] **Step 4: Run all tests to verify the refactor is behavior-preserving**

Run: `npm test`
Expected: PASS — same count as Step 1. If `test/index.test.js` imported a now-moved function directly, update its import to `../src/email.js`.

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add src/index.js src/email.js test/
git commit -m "refactor: extract email/registration/templates into src/email.js"
```

---

## Task 3: Service-token DA source/config client

**Files:**
- Create: `src/mcp/da-client.js`
- Test: `test/mcp/da-client.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/mcp/da-client.test.js
import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import { readRequestsSheet, writeRequestsSheet, fetchWorkflowConfig } from '../../src/mcp/da-client.js';

const ENV = { PUBLISH_WORKFLOW_SERVICE_TOKEN: 'svc-token' };

beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });

function ok(json) { return { ok: true, status: 200, json: async () => json }; }

describe('da-client', () => {
  it('reads the requests sheet with the service token', async () => {
    fetch.mockResolvedValueOnce(ok({ data: [{ path: '/a', status: 'pending' }] }));
    const sheet = await readRequestsSheet(ENV, 'org', 'site');
    expect(sheet.data[0].path).toBe('/a');
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe('https://admin.da.live/source/org/site/.da/publish-workflow-requests.json');
    expect(opts.headers.Authorization).toBe('Bearer svc-token');
  });

  it('writes the requests sheet as multipart PUT', async () => {
    fetch.mockResolvedValueOnce({ ok: true, status: 200 });
    await writeRequestsSheet(ENV, 'org', 'site', { data: [], total: 0 });
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe('https://admin.da.live/source/org/site/.da/publish-workflow-requests.json');
    expect(opts.method).toBe('PUT');
    expect(opts.body).toBeInstanceOf(FormData);
  });

  it('falls back to org-level config when site config lacks the tab', async () => {
    fetch
      .mockResolvedValueOnce(ok({})) // site-level: no publish-workflow-config
      .mockResolvedValueOnce(ok({ 'publish-workflow-config': { data: [{ Pattern: '/*' }] } }));
    const config = await fetchWorkflowConfig(ENV, 'org', 'site');
    expect(config['publish-workflow-config'].data[0].Pattern).toBe('/*');
    expect(fetch.mock.calls[0][0]).toBe('https://admin.da.live/config/org/site/');
    expect(fetch.mock.calls[1][0]).toBe('https://admin.da.live/config/org/');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/mcp/da-client.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the client**

```js
// src/mcp/da-client.js
import { DA_ADMIN, REQUESTS_SHEET_PATH } from './constants.js';

function authHeaders(env) {
  return {
    Authorization: `Bearer ${env.PUBLISH_WORKFLOW_SERVICE_TOKEN}`,
    Accept: 'application/json',
  };
}

function sheetUrl(org, site) {
  return `${DA_ADMIN}/source/${org}/${site}${REQUESTS_SHEET_PATH}`;
}

/** Read the requests sheet. Returns the parsed sheet object, or a seeded empty one. */
export async function readRequestsSheet(env, org, site) {
  const resp = await fetch(sheetUrl(org, site), { headers: authHeaders(env) });
  if (!resp.ok) return { data: [], total: 0, offset: 0, limit: 0 };
  return resp.json();
}

/** Write the requests sheet back to DA as multipart/form-data. */
export async function writeRequestsSheet(env, org, site, sheet) {
  const blob = new Blob([JSON.stringify(sheet)], { type: 'application/json' });
  const formData = new FormData();
  formData.append('data', blob);
  const resp = await fetch(sheetUrl(org, site), {
    method: 'PUT',
    headers: { Authorization: `Bearer ${env.PUBLISH_WORKFLOW_SERVICE_TOKEN}` },
    body: formData,
  });
  if (!resp.ok) throw new Error(`Failed to write requests sheet: ${resp.status}`);
  return { success: true };
}

/**
 * Fetch the workflow config: site-level first, then org-level fallback.
 * Mirrors api.js fetchWorkflowConfig, using the service token.
 */
export async function fetchWorkflowConfig(env, org, site) {
  const headers = authHeaders(env);
  const siteResp = await fetch(`${DA_ADMIN}/config/${org}/${site}/`, { headers });
  if (siteResp.ok) {
    const config = await siteResp.json();
    if (config['publish-workflow-config']) return config;
  }
  const orgResp = await fetch(`${DA_ADMIN}/config/${org}/`, { headers });
  if (orgResp.ok) {
    const config = await orgResp.json();
    if (config['publish-workflow-config']) return config;
  }
  return null;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/mcp/da-client.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
npm run lint
git add src/mcp/da-client.js test/mcp/da-client.test.js
git commit -m "feat(mcp): add service-token DA source/config client"
```

---

## Task 4: Port pure workflow logic (matching, expansion, settings)

These are verbatim ports from `api.js` — pure functions, no I/O, trivially testable.

**Files:**
- Create: `src/mcp/workflow.js`
- Test: `test/mcp/workflow.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/mcp/workflow.test.js
import { describe, it, expect } from 'vitest';
import {
  getPatternSpecificity, findBestMatchingRule, extractSetting, resolveApproversWithGroups,
} from '../../src/mcp/workflow.js';

describe('workflow pure logic', () => {
  it('scores pattern specificity: exact > deep wildcard > shallow > root', () => {
    expect(getPatternSpecificity('/a/b', '/a/b')).toBe(1000);
    expect(getPatternSpecificity('/a/b/c', '/a/b/*')).toBe(2);
    expect(getPatternSpecificity('/a/b/c', '/a/*')).toBe(1);
    expect(getPatternSpecificity('/a/b', '/*')).toBe(0);
    expect(getPatternSpecificity('/x', '/a/*')).toBe(-1);
  });

  it('picks the most specific matching rule', () => {
    const rules = [{ Pattern: '/*' }, { Pattern: '/drafts/*' }, { Pattern: '/drafts/jane/page' }];
    expect(findBestMatchingRule('/drafts/jane/page', rules).Pattern).toBe('/drafts/jane/page');
    expect(findBestMatchingRule('/drafts/bob/x', rules).Pattern).toBe('/drafts/*');
    expect(findBestMatchingRule('/other', rules).Pattern).toBe('/*');
  });

  it('expands DL groups and dedupes case-insensitively', () => {
    const groups = [{ group: 'dl-team@x.com', email: 'a@x.com, b@x.com' }];
    expect(resolveApproversWithGroups(['dl-team@x.com', 'B@x.com'], groups)).toEqual(['a@x.com', 'b@x.com']);
  });

  it('extracts a setting by key (case variants)', () => {
    const config = { 'publish-workflow-settings': { data: [{ key: 'approvals.cc.can-approve', value: 'true' }] } };
    expect(extractSetting(config, 'approvals.cc.can-approve')).toBe('true');
    expect(extractSetting(config, 'missing')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/mcp/workflow.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement (port verbatim from `tools/apps/publish-requests-inbox/api.js`)**

```js
// src/mcp/workflow.js
/* eslint-disable no-restricted-syntax, no-continue */

/** Specificity of a pattern vs a path. Higher = more specific. -1 = no match. */
export function getPatternSpecificity(path, pattern) {
  if (pattern === '/*' || pattern === '*') return 0;
  if (pattern.endsWith('/*')) {
    const prefix = pattern.slice(0, -2);
    if (path.startsWith(prefix)) return prefix.split('/').filter(Boolean).length;
    return -1;
  }
  if (path === pattern) return 1000;
  return -1;
}

/** Best (most specific) matching rule for a path, or null. */
export function findBestMatchingRule(path, rules) {
  let bestRule = null;
  let bestSpecificity = -1;
  for (const rule of rules) {
    const pattern = rule.Pattern || rule.pattern;
    if (!pattern) continue;
    const specificity = getPatternSpecificity(path, pattern);
    if (specificity > bestSpecificity) {
      bestSpecificity = specificity;
      bestRule = rule;
    }
  }
  return bestRule;
}

/** Look up a value in the publish-workflow-settings tab. */
export function extractSetting(config, key) {
  const settings = config?.['publish-workflow-settings']?.data || [];
  const entry = settings.find((r) => (r.key || r.Key) === key);
  return entry?.value || entry?.Value || null;
}

/** Expand DL groups to individual emails, deduped case-insensitively. */
export function resolveApproversWithGroups(approversList, groupsData) {
  const resolved = [];
  for (const approver of approversList) {
    const group = groupsData.find((g) => g.group?.toLowerCase() === approver.toLowerCase());
    if (group) {
      resolved.push(...group.email.split(',').map((e) => e.trim()).filter(Boolean));
    } else {
      resolved.push(approver);
    }
  }
  const seen = new Set();
  return resolved.filter((email) => {
    const lower = email.toLowerCase();
    if (seen.has(lower)) return false;
    seen.add(lower);
    return true;
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/mcp/workflow.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
npm run lint
git add src/mcp/workflow.js test/mcp/workflow.test.js
git commit -m "feat(mcp): port pure workflow logic (matching, group expansion, settings)"
```

---

## Task 5: Resolution + sheet-edit helpers (config-driven, pure inputs)

Functions that take already-fetched `config`/`sheet` objects so they stay pure and testable. Added to `src/mcp/workflow.js`.

**Files:**
- Modify: `src/mcp/workflow.js`
- Test: `test/mcp/workflow.test.js` (extend)

- [ ] **Step 1: Add failing tests**

```js
// append to test/mcp/workflow.test.js
import {
  resolveApproversAndCc, filterPendingForApprover, removeRowsForPaths, appendRequestRow,
} from '../../src/mcp/workflow.js';

const CONFIG = {
  'publish-workflow-config': { data: [{ Pattern: '/drafts/*', Approvers: 'jane@x.com', CC: 'cc@x.com' }] },
  'publish-workflow-groups-to-email': { data: [] },
  'publish-workflow-settings': { data: [] },
};

describe('workflow resolution + sheet edits', () => {
  it('resolves approvers (and cc only when cc.can-approve)', () => {
    expect(resolveApproversAndCc(CONFIG, '/drafts/x')).toEqual({ approvers: ['jane@x.com'], cc: ['cc@x.com'] });
  });

  it('filters pending requests to those the user may approve', () => {
    const requests = [
      { path: '/drafts/x', status: 'pending' },
      { path: '/drafts/y', status: 'pending' },
      { path: '/drafts/x', status: 'done' },
    ];
    const out = filterPendingForApprover(CONFIG, requests, 'JANE@x.com');
    expect(out.map((r) => r.path)).toEqual(['/drafts/x', '/drafts/y']);
  });

  it('removes matching pending rows, preserving the empty first row', () => {
    const sheet = { data: [{ path: '', status: '' }, { path: '/a', status: 'pending' }, { path: '/b', status: 'pending' }] };
    const { sheet: out, removedCount } = removeRowsForPaths(sheet, ['/a']);
    expect(removedCount).toBe(1);
    expect(out.data).toEqual([{ path: '', status: '' }, { path: '/b', status: 'pending' }]);
  });

  it('appends a request row, seeding an empty header row when needed', () => {
    const out = appendRequestRow({ data: [] }, {
      requester: 'a@x.com', approver: 'jane@x.com', path: '/p', comment: 'hi', status: 'pending', created: 'T',
    });
    expect(out.data[0]).toEqual({ requester: '', approver: '', path: '', comment: '', status: '', created: '' });
    expect(out.data[1].path).toBe('/p');
    expect(out.total).toBe(2);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/mcp/workflow.test.js`
Expected: FAIL — new exports not defined.

- [ ] **Step 3: Implement (port the authorization + sheet-structure logic from `api.js`)**

```js
// append to src/mcp/workflow.js
import { REQUEST_COLUMNS } from './constants.js';

function toList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') return value.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}

/** Resolved { approvers, cc } for a path. cc only included if cc.can-approve is true. */
export function resolveApproversAndCc(config, path) {
  const rules = config['publish-workflow-config']?.data || config.data || [];
  const groupsData = config['publish-workflow-groups-to-email']?.data || [];
  const ccCanApprove = extractSetting(config, 'approvals.cc.can-approve')?.toLowerCase() === 'true';
  const rule = findBestMatchingRule(path, rules);
  if (!rule) return { approvers: [], cc: [] };
  const approvers = resolveApproversWithGroups(toList(rule.Approvers || rule.approvers), groupsData);
  const cc = ccCanApprove ? resolveApproversWithGroups(toList(rule.CC || rule.cc), groupsData) : [];
  return { approvers, cc };
}

/** Pending requests the user is authorized to approve (approvers + optionally cc). */
export function filterPendingForApprover(config, requests, userEmail) {
  const normalizedUser = userEmail.toLowerCase();
  const pending = requests.filter((r) => r.status === 'pending' && r.path);
  return pending.filter((request) => {
    const { approvers, cc } = resolveApproversAndCc(config, request.path);
    return [...approvers, ...cc].some((a) => a.toLowerCase() === normalizedUser);
  });
}

/** Build the empty header row that preserves column keys. */
function emptyRow(keys) {
  return Object.fromEntries(keys.map((k) => [k, '']));
}

/** Remove pending rows whose path is in `paths`. Preserves the empty first row. */
export function removeRowsForPaths(sheet, paths) {
  const rows = sheet.data || [];
  const keys = rows.length > 0 ? Object.keys(rows[0]) : REQUEST_COLUMNS;
  const dataRows = rows.slice(1);
  const pathSet = new Set(paths);
  const filteredData = dataRows.filter((r) => !(pathSet.has(r.path) && r.status === 'pending'));
  const filtered = [emptyRow(keys), ...filteredData];
  const removedCount = dataRows.length - filteredData.length;
  return {
    sheet: {
      ...sheet, total: filtered.length, offset: 0, limit: filtered.length, data: filtered,
    },
    removedCount,
  };
}

/** Append a request row, seeding the empty header row if the sheet is empty. */
export function appendRequestRow(sheet, row) {
  const rows = sheet.data || [];
  const base = rows.length > 0 ? rows : [emptyRow(REQUEST_COLUMNS)];
  const data = [...base, row];
  return {
    ...sheet, total: data.length, offset: 0, limit: data.length, data,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/mcp/workflow.test.js`
Expected: PASS (8 tests total).

- [ ] **Step 5: Commit**

```bash
npm run lint
git add src/mcp/workflow.js test/mcp/workflow.test.js
git commit -m "feat(mcp): add resolution + sheet-edit helpers"
```

---

## Task 6: Service-token Helix publish client

**Files:**
- Create: `src/mcp/publish-client.js`
- Test: `test/mcp/publish-client.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/mcp/publish-client.test.js
import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import { publishContent, bulkPublishContent, pollJobStatus } from '../../src/mcp/publish-client.js';

const ENV = { PUBLISH_WORKFLOW_SERVICE_TOKEN: 'svc' };
beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });

describe('publish-client', () => {
  it('publishes a single path against admin.hlx.page with the service token', async () => {
    fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ live: { status: 200 } }) });
    const out = await publishContent(ENV, 'org', 'site', 'page');
    expect(out.success).toBe(true);
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe('https://admin.hlx.page/live/org/site/main/page');
    expect(opts.method).toBe('POST');
    expect(opts.headers.Authorization).toBe('Bearer svc');
  });

  it('starts a bulk publish job and returns the self link', async () => {
    fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ job: { name: 'j1' }, links: { self: 'https://admin.hlx.page/job/x' } }) });
    const out = await bulkPublishContent(ENV, 'org', 'site', ['/a', '/b']);
    expect(out.success).toBe(true);
    expect(out.links.self).toBe('https://admin.hlx.page/job/x');
  });

  it('polls a job until it reaches a terminal state', async () => {
    fetch
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ state: 'running' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ state: 'completed' }) });
    const out = await pollJobStatus(ENV, 'https://admin.hlx.page/job/x', 10000, 1);
    expect(out.success).toBe(true);
    expect(out.job.state).toBe('completed');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/mcp/publish-client.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement (port from `api.js`; drop the browser CORS proxy — the worker calls admin.hlx.page directly)**

```js
// src/mcp/publish-client.js
/* eslint-disable no-await-in-loop */
import { ADMIN_HLX } from './constants.js';

function authHeaders(env, extra = {}) {
  return { Authorization: `Bearer ${env.PUBLISH_WORKFLOW_SERVICE_TOKEN}`, ...extra };
}

/** Publish a single path. POST {ADMIN_HLX}/live/{org}/{site}/main{path}. */
export async function publishContent(env, org, site, path) {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const url = `${ADMIN_HLX}/live/${org}/${site}/main${cleanPath}`;
  const resp = await fetch(url, { method: 'POST', headers: authHeaders(env) });
  if (!resp.ok) {
    const errorText = await resp.text();
    return { success: false, error: `Publish failed: ${resp.status} ${errorText}` };
  }
  return { success: true, data: await resp.json() };
}

/** Start a bulk publish job. POST {ADMIN_HLX}/live/{org}/{site}/main/* { paths }. */
export async function bulkPublishContent(env, org, site, paths) {
  const cleanPaths = paths.map((p) => (p.startsWith('/') ? p : `/${p}`));
  const url = `${ADMIN_HLX}/live/${org}/${site}/main/*`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: authHeaders(env, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ paths: cleanPaths }),
  });
  if (!resp.ok) {
    const errorText = await resp.text();
    return { success: false, error: `Bulk publish failed: ${resp.status} ${errorText}` };
  }
  const result = await resp.json();
  return { success: true, data: result, job: result.job, links: result.links };
}

/** Poll a bulk job's {self}/details until terminal (stopped|completed) or timeout. */
export async function pollJobStatus(env, jobSelfUrl, maxWaitMs = 60000, intervalMs = 2000) {
  const jobUrl = `${jobSelfUrl}/details`;
  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
    const resp = await fetch(jobUrl, { headers: authHeaders(env) });
    if (!resp.ok) break;
    const job = await resp.json();
    if (job.state === 'stopped' || job.state === 'completed') return { success: true, job };
    await new Promise((resolve) => { setTimeout(resolve, intervalMs); });
  }
  return { success: false, error: 'Job polling timed out or encountered an error' };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/mcp/publish-client.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
npm run lint
git add src/mcp/publish-client.js test/mcp/publish-client.test.js
git commit -m "feat(mcp): add service-token Helix publish client"
```

---

## Task 7: Read-only tools (`list_pending_requests`, `get_request_details`, `get_approvers_for_path`)

**Files:**
- Modify: `src/mcp/tools.js` (replace the empty registry)
- Test: `test/mcp/tools.read.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/mcp/tools.read.test.js
import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import { TOOLS } from '../../src/mcp/tools.js';

const ENV = { PUBLISH_WORKFLOW_SERVICE_TOKEN: 'svc' };
beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
function ok(json) { return { ok: true, status: 200, json: async () => json }; }

const CONFIG = {
  'publish-workflow-config': { data: [{ Pattern: '/drafts/*', Approvers: 'jane@x.com' }] },
  'publish-workflow-groups-to-email': { data: [] },
  'publish-workflow-settings': { data: [] },
};

describe('read-only tools', () => {
  it('exposes the three read tools with readOnlyHint', () => {
    const names = TOOLS.definitions.filter((d) => d.annotations?.readOnlyHint).map((d) => d.name);
    expect(names).toEqual(expect.arrayContaining(['list_pending_requests', 'get_request_details', 'get_approvers_for_path']));
  });

  it('list_pending_requests returns only requests the user can approve', async () => {
    fetch
      .mockResolvedValueOnce(ok(CONFIG)) // fetchWorkflowConfig site-level
      .mockResolvedValueOnce(ok({ data: [{ path: '/drafts/x', status: 'pending', requester: 'a@x.com' }] })); // sheet
    const out = await TOOLS.handlers.list_pending_requests(
      { org: 'o', site: 's', userEmail: 'jane@x.com' }, ENV,
    );
    expect(out.requests).toHaveLength(1);
    expect(out.requests[0].path).toBe('/drafts/x');
  });

  it('get_approvers_for_path resolves approvers', async () => {
    fetch.mockResolvedValueOnce(ok(CONFIG));
    const out = await TOOLS.handlers.get_approvers_for_path({ org: 'o', site: 's', path: '/drafts/x' }, ENV);
    expect(out.approvers).toEqual(['jane@x.com']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/mcp/tools.read.test.js`
Expected: FAIL — handlers undefined.

- [ ] **Step 3: Implement the read tools (replace `src/mcp/tools.js`)**

```js
// src/mcp/tools.js
import { readRequestsSheet, fetchWorkflowConfig } from './da-client.js';
import { resolveApproversAndCc, filterPendingForApprover } from './workflow.js';

async function loadConfigOrThrow(env, org, site) {
  const config = await fetchWorkflowConfig(env, org, site);
  if (!config) throw new Error(`Publish workflow config not found for ${org}/${site}.`);
  return config;
}

const listPending = {
  definition: {
    name: 'list_pending_requests',
    description: 'List pending publish requests the given user is authorized to approve.',
    inputSchema: {
      type: 'object',
      properties: {
        org: { type: 'string' }, site: { type: 'string' }, userEmail: { type: 'string', description: 'The approver email (the chat user).' },
      },
      required: ['org', 'site', 'userEmail'],
    },
    annotations: { readOnlyHint: true },
  },
  handler: async ({ org, site, userEmail }, env) => {
    const [config, sheet] = await Promise.all([
      loadConfigOrThrow(env, org, site),
      readRequestsSheet(env, org, site),
    ]);
    const requests = filterPendingForApprover(config, sheet.data || [], userEmail);
    return { requests, humanReadableSummary: `${requests.length} request(s) awaiting your approval` };
  },
};

const getDetails = {
  definition: {
    name: 'get_request_details',
    description: 'Get details + preview/live URLs for a pending request at a path.',
    inputSchema: {
      type: 'object',
      properties: { org: { type: 'string' }, site: { type: 'string' }, path: { type: 'string' } },
      required: ['org', 'site', 'path'],
    },
    annotations: { readOnlyHint: true },
  },
  handler: async ({ org, site, path }, env) => {
    const sheet = await readRequestsSheet(env, org, site);
    const request = (sheet.data || []).find((r) => r.path === path && r.status === 'pending') || null;
    const pagePath = path.replace(/\/index$/, '');
    return {
      request,
      previewUrl: `https://main--${site}--${org}.aem.page${pagePath}`,
      liveUrl: `https://main--${site}--${org}.aem.live${pagePath}`,
    };
  },
};

const getApprovers = {
  definition: {
    name: 'get_approvers_for_path',
    description: 'Resolve who would be notified/authorized for a path (approvers + CC, groups expanded).',
    inputSchema: {
      type: 'object',
      properties: { org: { type: 'string' }, site: { type: 'string' }, path: { type: 'string' } },
      required: ['org', 'site', 'path'],
    },
    annotations: { readOnlyHint: true },
  },
  handler: async ({ org, site, path }, env) => {
    const config = await loadConfigOrThrow(env, org, site);
    const { approvers, cc } = resolveApproversAndCc(config, path);
    return { approvers, cc, humanReadableSummary: `Would notify ${approvers.length} approver(s)` };
  },
};

const ALL = [listPending, getDetails, getApprovers];

export const TOOLS = {
  definitions: ALL.map((t) => t.definition),
  handlers: Object.fromEntries(ALL.map((t) => [t.definition.name, t.handler])),
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/mcp/tools.read.test.js test/mcp/transport.test.js`
Expected: PASS (transport's `tools/list` now returns 3 tools).

- [ ] **Step 5: Commit**

```bash
npm run lint
git add src/mcp/tools.js test/mcp/tools.read.test.js
git commit -m "feat(mcp): add read-only tools (list/details/approvers)"
```

---

## Task 8: `request_publish` tool (gated)

Resolve approvers/CC → enforce `comments.required` → reject duplicate pending → write a pending row → send the approval email via `src/email.js`.

**Files:**
- Modify: `src/mcp/tools.js`
- Test: `test/mcp/tools.request.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/mcp/tools.request.test.js
import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';

const sendEmail = vi.fn();
vi.mock('../../src/email.js', () => ({
  sendEmail: (...a) => sendEmail(...a),
  getRegistrationConfig: async () => ({ allowedEmailDomains: ['x.com'] }),
  getTemplates: () => ({ approval: '<html>{{path}}</html>' }),
}));

const { TOOLS } = await import('../../src/mcp/tools.js');

const ENV = { PUBLISH_WORKFLOW_SERVICE_TOKEN: 'svc' };
beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); sendEmail.mockReset(); });
function ok(json) { return { ok: true, status: 200, json: async () => json }; }

const CONFIG = {
  'publish-workflow-config': { data: [{ Pattern: '/drafts/*', Approvers: 'jane@x.com' }] },
  'publish-workflow-groups-to-email': { data: [] },
  'publish-workflow-settings': { data: [{ key: 'request.comments.required', value: 'true' }] },
};

describe('request_publish', () => {
  it('is advertised as destructive', () => {
    const def = TOOLS.definitions.find((d) => d.name === 'request_publish');
    expect(def.annotations.destructiveHint).toBe(true);
  });

  it('errors when a required comment is missing', async () => {
    fetch.mockResolvedValueOnce(ok(CONFIG)); // config
    await expect(TOOLS.handlers.request_publish(
      { org: 'o', site: 's', path: '/drafts/x', authorEmail: 'a@x.com' }, ENV,
    )).rejects.toThrow(/comment/i);
  });

  it('writes a pending row and emails approvers', async () => {
    fetch
      .mockResolvedValueOnce(ok(CONFIG)) // fetchWorkflowConfig
      .mockResolvedValueOnce(ok({ data: [] })) // readRequestsSheet (duplicate check + append)
      .mockResolvedValueOnce({ ok: true, status: 200 }); // writeRequestsSheet
    sendEmail.mockResolvedValueOnce({});
    const out = await TOOLS.handlers.request_publish(
      {
        org: 'o', site: 's', path: '/drafts/x', authorEmail: 'a@x.com', comment: 'please review',
      }, ENV,
    );
    expect(out.notifiedApprovers).toEqual(['jane@x.com']);
    expect(sendEmail).toHaveBeenCalledOnce();
    // last fetch was the PUT write
    const putCall = fetch.mock.calls.at(-1);
    expect(putCall[1].method).toBe('PUT');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/mcp/tools.request.test.js`
Expected: FAIL — `request_publish` handler undefined.

- [ ] **Step 3: Implement (add to `src/mcp/tools.js`)**

Add imports at the top:

```js
import { writeRequestsSheet } from './da-client.js';
import { resolveApproversAndCc, extractSetting, appendRequestRow } from './workflow.js';
import { sendEmail, getRegistrationConfig, getTemplates } from '../email.js';
import { buildApprovalRequestEmail, sanitizeHeaderValue } from '../utils.js';
```

(Adjust the existing `./workflow.js` import line to include `extractSetting` and `appendRequestRow` rather than duplicating it.)

Add the tool before the `const ALL = [...]` line:

```js
const requestPublish = {
  definition: {
    name: 'request_publish',
    description: 'Submit a publish request: resolve approvers, record a pending request, and email approvers. Confirm with the user before calling.',
    inputSchema: {
      type: 'object',
      properties: {
        org: { type: 'string' },
        site: { type: 'string' },
        path: { type: 'string' },
        authorEmail: { type: 'string', description: 'The requester (chat user) email.' },
        comment: { type: 'string' },
      },
      required: ['org', 'site', 'path', 'authorEmail'],
    },
    annotations: { destructiveHint: true },
  },
  handler: async ({
    org, site, path, authorEmail, comment,
  }, env) => {
    const config = await loadConfigOrThrow(env, org, site);

    const required = extractSetting(config, 'request.comments.required')?.toLowerCase() === 'true';
    const minLen = parseInt(extractSetting(config, 'request.comments.length') || '0', 10);
    if (required && (!comment || comment.trim().length < (minLen || 1))) {
      throw new Error(`A comment of at least ${minLen || 1} characters is required for this site.`);
    }

    const { approvers, cc } = resolveApproversAndCc(config, path);
    if (approvers.length === 0) throw new Error(`No approvers configured for ${path}.`);

    const sheet = await readRequestsSheet(env, org, site);
    const duplicate = (sheet.data || []).find((r) => r.path === path && r.status === 'pending');
    if (duplicate) throw new Error(`A pending request already exists for ${path}.`);

    const updated = appendRequestRow(sheet, {
      requester: authorEmail,
      approver: approvers.join(','),
      path,
      comment: comment || '',
      status: 'pending',
      created: new Date().toISOString(),
    });
    await writeRequestsSheet(env, org, site, updated);

    const registration = await getRegistrationConfig(env, org, site);
    const pagePath = path.replace(/\/index$/, '');
    const previewUrl = `https://main--${site}--${org}.aem.page${pagePath}`;
    const inboxUrl = `https://da.live/app/adobe-rnd/aem-apps/tools/apps/publish-requests-inbox/publish-requests-inbox?org=${encodeURIComponent(org)}&site=${encodeURIComponent(site)}`;
    const html = buildApprovalRequestEmail(getTemplates(org, site).approval, {
      org, site, path, previewUrl, authorEmail, comment, appUrl: inboxUrl, inboxUrl,
    });
    await sendEmail(env, {
      to: approvers,
      cc,
      subject: `[Website Publish Request] ${sanitizeHeaderValue(path)}`,
      html,
    }, registration);

    return {
      notifiedApprovers: approvers,
      cc,
      humanReadableSummary: `Requested publish for ${path}; notified ${approvers.length} approver(s)`,
    };
  },
};
```

Then add `requestPublish` to the `ALL` array: `const ALL = [listPending, getDetails, getApprovers, requestPublish];`

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/mcp/tools.request.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
npm run lint
git add src/mcp/tools.js test/mcp/tools.request.test.js
git commit -m "feat(mcp): add request_publish tool"
```

---

## Task 9: `approve_request` + `reject_request` tools (gated)

**Files:**
- Modify: `src/mcp/tools.js`
- Test: `test/mcp/tools.approve.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/mcp/tools.approve.test.js
import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';

const sendEmail = vi.fn();
vi.mock('../../src/email.js', () => ({
  sendEmail: (...a) => sendEmail(...a),
  getRegistrationConfig: async () => ({ allowedEmailDomains: ['x.com'] }),
  getTemplates: () => ({ published: '<html>ok</html>', rejection: '<html>no</html>' }),
}));

const { TOOLS } = await import('../../src/mcp/tools.js');
const ENV = { PUBLISH_WORKFLOW_SERVICE_TOKEN: 'svc' };
beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); sendEmail.mockReset(); });
function ok(json) { return { ok: true, status: 200, json: async () => json }; }

describe('approve/reject', () => {
  it('advertises both as destructive', () => {
    const a = TOOLS.definitions.find((d) => d.name === 'approve_request');
    const r = TOOLS.definitions.find((d) => d.name === 'reject_request');
    expect(a.annotations.destructiveHint).toBe(true);
    expect(r.annotations.destructiveHint).toBe(true);
  });

  it('approve publishes, removes the row, and notifies the author', async () => {
    fetch
      .mockResolvedValueOnce(ok({ data: [{ path: '', status: '' }, { path: '/drafts/x', status: 'pending', requester: 'a@x.com' }] })) // read sheet (for author lookup)
      .mockResolvedValueOnce(ok({ live: { status: 200 } })) // publishContent
      .mockResolvedValueOnce(ok({ data: [{ path: '', status: '' }, { path: '/drafts/x', status: 'pending', requester: 'a@x.com' }] })) // read sheet (for removal)
      .mockResolvedValueOnce({ ok: true, status: 200 }); // write sheet
    sendEmail.mockResolvedValueOnce({});
    const out = await TOOLS.handlers.approve_request(
      { org: 'o', site: 's', paths: ['/drafts/x'], approverEmail: 'jane@x.com' }, ENV,
    );
    expect(out.published).toEqual(['/drafts/x']);
    expect(sendEmail).toHaveBeenCalledOnce();
  });

  it('reject removes the row and emails the author', async () => {
    fetch
      .mockResolvedValueOnce(ok({ data: [{ path: '', status: '' }, { path: '/drafts/x', status: 'pending', requester: 'a@x.com' }] })) // read for author
      .mockResolvedValueOnce(ok({ data: [{ path: '', status: '' }, { path: '/drafts/x', status: 'pending', requester: 'a@x.com' }] })) // read for removal
      .mockResolvedValueOnce({ ok: true, status: 200 }); // write
    sendEmail.mockResolvedValueOnce({});
    const out = await TOOLS.handlers.reject_request(
      {
        org: 'o', site: 's', path: '/drafts/x', approverEmail: 'jane@x.com', reason: 'needs work',
      }, ENV,
    );
    expect(out.success).toBe(true);
    expect(sendEmail).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/mcp/tools.approve.test.js`
Expected: FAIL — handlers undefined.

- [ ] **Step 3: Implement (add to `src/mcp/tools.js`)**

Add imports:

```js
import { publishContent } from './publish-client.js';
import { removeRowsForPaths } from './workflow.js';
import { buildPublishedEmail, buildRejectionEmail } from '../utils.js';
```

(Merge the new `./workflow.js` and `../utils.js` names into the existing import lines.)

Add a helper and the two tools before `const ALL`:

```js
async function authorForPath(env, org, site, path) {
  const sheet = await readRequestsSheet(env, org, site);
  const row = (sheet.data || []).find((r) => r.path === path && r.status === 'pending');
  return row?.requester || null;
}

const approveRequest = {
  definition: {
    name: 'approve_request',
    description: 'Approve and publish one or more pending requests, then notify authors. Confirm with the user before calling.',
    inputSchema: {
      type: 'object',
      properties: {
        org: { type: 'string' },
        site: { type: 'string' },
        paths: { type: 'array', items: { type: 'string' } },
        approverEmail: { type: 'string' },
      },
      required: ['org', 'site', 'paths', 'approverEmail'],
    },
    annotations: { destructiveHint: true },
  },
  handler: async ({
    org, site, paths, approverEmail,
  }, env) => {
    const published = [];
    const failed = [];
    const authorByPath = {};
    for (const path of paths) {
      // eslint-disable-next-line no-await-in-loop
      authorByPath[path] = await authorForPath(env, org, site, path);
      // eslint-disable-next-line no-await-in-loop
      const result = await publishContent(env, org, site, path);
      if (result.success) published.push(path); else failed.push({ path, error: result.error });
    }

    if (published.length > 0) {
      const sheet = await readRequestsSheet(env, org, site);
      const { sheet: updated } = removeRowsForPaths(sheet, published);
      await writeRequestsSheet(env, org, site, updated);

      const registration = await getRegistrationConfig(env, org, site);
      const byAuthor = {};
      for (const path of published) {
        const author = authorByPath[path];
        if (!author) continue;
        (byAuthor[author] = byAuthor[author] || []).push(path);
      }
      await Promise.all(Object.entries(byAuthor).map(async ([author, authorPaths]) => {
        const html = await buildPublishedEmail(getTemplates(org, site).published, {
          org, site, paths: authorPaths, approverEmail,
        });
        return sendEmail(env, {
          to: [author],
          subject: authorPaths.length > 1
            ? `[Published] ${authorPaths.length} pages published`
            : `[Published] ${sanitizeHeaderValue(authorPaths[0])}`,
          html,
        }, registration);
      }));
    }

    return { published, failed, humanReadableSummary: `Published ${published.length} page(s)${failed.length ? `, ${failed.length} failed` : ''}` };
  },
};

const rejectRequest = {
  definition: {
    name: 'reject_request',
    description: 'Reject a pending request: remove it and email the author the reason. Confirm with the user before calling.',
    inputSchema: {
      type: 'object',
      properties: {
        org: { type: 'string' },
        site: { type: 'string' },
        path: { type: 'string' },
        approverEmail: { type: 'string' },
        reason: { type: 'string' },
      },
      required: ['org', 'site', 'path', 'approverEmail', 'reason'],
    },
    annotations: { destructiveHint: true },
  },
  handler: async ({
    org, site, path, approverEmail, reason,
  }, env) => {
    const author = await authorForPath(env, org, site, path);
    const sheet = await readRequestsSheet(env, org, site);
    const { sheet: updated, removedCount } = removeRowsForPaths(sheet, [path]);
    await writeRequestsSheet(env, org, site, updated);

    if (author) {
      const registration = await getRegistrationConfig(env, org, site);
      const html = buildRejectionEmail(getTemplates(org, site).rejection, {
        org, site, path, authorEmail: author, rejecterEmail: approverEmail, reason,
      });
      await sendEmail(env, {
        to: [author],
        subject: `[Rejected] Website Publish Request: ${sanitizeHeaderValue(path)}`,
        html,
      }, registration);
    }

    return { success: removedCount > 0, humanReadableSummary: `Rejected ${path}` };
  },
};
```

Add both to `ALL`: `const ALL = [listPending, getDetails, getApprovers, requestPublish, approveRequest, rejectRequest];`

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/mcp/`
Expected: PASS (all MCP test files green).

- [ ] **Step 5: Full suite + lint + commit**

Run: `npm test` (expect the original tests + all new MCP tests passing).

```bash
npm run lint
git add src/mcp/tools.js test/mcp/tools.approve.test.js
git commit -m "feat(mcp): add approve_request and reject_request tools"
```

---

## Task 10: Skill, agent preset, deploy, and test-site registration (manual e2e)

This task ships the runtime config and verifies the end-to-end POC against prod `agent.da.live`. No unit tests — it ends with a manual verification checklist.

**Files:**
- Create: `mcp-assets/skill.md`, `mcp-assets/agent-preset.json`, `mcp-assets/mcp-servers-row.md`

- [ ] **Step 1: Author the skill**

```markdown
<!-- mcp-assets/skill.md  →  install to TEST site at .da/skills/request-publish/skill.md -->
---
name: request-publish
description: Submit, list, approve, and reject website publish requests. Use whenever the user wants to request approval to publish a page, see what is awaiting their approval, or approve/reject pending requests.
status: approved
---

# Request Publish

You manage the website publish-approval workflow via the `publish-workflow` MCP tools.

## Context
- Always use `org`, `site`, and `path` from the current `pageContext`. Never guess them.
- The chat user's email is their identity: pass it as `authorEmail` (when requesting) or `approverEmail`/`userEmail` (when approving/listing). If you do not know it, ask.

## Mapping intent to tools
- "request approval / send for sign-off / ready to publish / submit publish request" → `request_publish`
- "what's awaiting my approval / my queue / anything to approve" → `list_pending_requests`
- "approve <page(s)> / publish the approved ones" → `approve_request`
- "reject <page> / send back" → `reject_request`
- "who approves this / who gets notified" → `get_approvers_for_path`

## REQUIRED: confirm before acting
`request_publish`, `approve_request`, and `reject_request` change state and send email.
Before calling any of them, **state plainly what will happen** (which paths, which approvers/authors) and **wait for the user to confirm**. Prefer calling the read-only `get_approvers_for_path` first to show who will be notified.

## Notes
- If a tool reports a required comment is missing, ask the user for one and retry.
- Report partial failures from `approve_request` (failed paths stay pending).
```

- [ ] **Step 2: Author the agent preset**

```json
// mcp-assets/agent-preset.json  →  install to TEST site at .da/agents/publish-workflow.json
{
  "name": "Publish Workflow",
  "description": "Request, review, approve, and reject website publish requests from chat.",
  "systemPrompt": "You help authors and approvers run the website publish-approval workflow. Follow the request-publish skill exactly, especially confirming before any state-changing action.",
  "skills": ["request-publish"],
  "mcpServers": ["publish-workflow"]
}
```

- [ ] **Step 3: Write the registration instructions**

```markdown
<!-- mcp-assets/mcp-servers-row.md -->
# Register the MCP server in the TEST site config

In the TEST site's config (via the Skills Editor or by editing the config sheet), add a row to the `mcp-servers` tab:

| key | url | status | enabled | headers |
|-----|-----|--------|---------|---------|
| publish-workflow | https://publish-requests.aem-poc-lab.workers.dev/mcp | approved | true | [{"name":"x-mcp-secret","value":"<MCP_SHARED_SECRET>"}] |

Notes:
- `<MCP_SHARED_SECRET>` must equal the worker secret set in Step 4.
- POC caveat: this secret is visible to anyone who can read the site config. Acceptable for a throwaway test site only.
```

- [ ] **Step 4: Set the worker secrets and deploy**

```bash
# From cloudadoption/codebase/publish-requests-worker/
npx wrangler secret put MCP_SHARED_SECRET                # paste a random string; reuse it in the config row
npx wrangler secret put PUBLISH_WORKFLOW_SERVICE_TOKEN   # paste a dev IMS token with content-write on the TEST org/site
npm run deploy
```

- [ ] **Step 5: Smoke-test the endpoint directly**

```bash
SECRET="<the MCP_SHARED_SECRET you set>"
curl -s -X POST https://publish-requests.aem-poc-lab.workers.dev/mcp \
  -H "Content-Type: application/json" -H "x-mcp-secret: $SECRET" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq '.result.tools[].name'
```
Expected: the six tool names. A wrong/absent `x-mcp-secret` returns HTTP 401.

- [ ] **Step 6: Install the skill + preset into the TEST site**

Upload `mcp-assets/skill.md` to the test site at `.da/skills/request-publish/skill.md`, and `mcp-assets/agent-preset.json` at `.da/agents/publish-workflow.json` (via the DA UI / Skills Editor, or `PUT {DA_ADMIN}/source/{org}/{site}/.da/...`). Add the `mcp-servers` row from Step 3 to the test site config.

- [ ] **Step 7: Manual end-to-end verification (prod agent.da.live)**

Open da-nx Chat on a page in the TEST site and verify each, confirming when the agent asks:

- [ ] "Who approves this page?" → agent calls `get_approvers_for_path`, lists the configured approvers.
- [ ] "Request publish for this page" with a comment → agent confirms, calls `request_publish`; the approver receives the email; a pending row appears in the inbox app (cross-surface sync).
- [ ] As an approver: "What's awaiting my approval?" → `list_pending_requests` returns the request.
- [ ] "Approve it" → agent confirms, calls `approve_request`; the page goes live; the author gets the published email; the request disappears from the inbox app.
- [ ] "Reject it with reason X" on a fresh request → `reject_request`; author gets the rejection email; row removed.
- [ ] Confirm the existing plugin + inbox app still work unchanged (backwards-compat).

- [ ] **Step 8: Commit the assets**

```bash
git add mcp-assets/
git commit -m "feat(mcp): add request-publish skill, agent preset, and registration assets"
```

---

# Phase 1.5 (fast-follow) — Mint the service token via OAuth Server-to-Server

**Why:** Phase 1 uses your own DA user token pasted into `PUBLISH_WORKFLOW_SERVICE_TOKEN` — it works immediately but expires (~24h) and is attributed to you. Phase 1.5 replaces it with a **technical-account** token minted at runtime from the Adobe Developer Console **"Edge Delivery Services"** OAuth Server-to-Server credential (project *Request Publish MCP Token*). No more daily re-paste; stable service identity.

**Reference values (from the credential):**
- Client ID (API key): `2ce60c64c0424378ae571b1a7b1a005e`
- Scopes: `openid,AdobeID,aem.frontend.all,additional_info.projectedProductContext,read_organizations`
- Technical Account Email: `bc75dbeb-8319-41bb-9df7-3ed039fb92f2@techacct.adobe.com`
- Org ID: `138A07885EE042D20A495CFA@AdobeOrg`

**Prerequisite (manual, owner does this):** grant the Technical Account Email **content-write access on the TEST DA site**, exactly as a human collaborator would be added. Without this, minted tokens authenticate but DA Admin/Helix will return 403.

**Design:** introduce `getServiceToken(env)` as the single source of the bearer. It returns `PUBLISH_WORKFLOW_SERVICE_TOKEN` when set (Phase 1 escape hatch / local dev), otherwise mints + caches a client_credentials token. Then retrofit `da-client.js` and `publish-client.js` to call it. To flip from Phase 1 → 1.5 in production you simply **unset** `PUBLISH_WORKFLOW_SERVICE_TOKEN` and set the OAuth secrets — no code change.

## Task 11: `getServiceToken` — client_credentials minting + caching

**Files:**
- Create: `src/mcp/service-token.js`
- Modify: `wrangler.toml` (document secrets)
- Test: `test/mcp/service-token.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/mcp/service-token.test.js
import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import { getServiceToken, __resetServiceTokenCache } from '../../src/mcp/service-token.js';

beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); __resetServiceTokenCache(); });

describe('getServiceToken', () => {
  it('short-circuits to a static token when provided', async () => {
    const t = await getServiceToken({ PUBLISH_WORKFLOW_SERVICE_TOKEN: 'static' });
    expect(t).toBe('static');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('mints via client_credentials and caches until near expiry', async () => {
    fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ access_token: 'minted', expires_in: 86400 }) });
    const env = { EDS_OAUTH_CLIENT_ID: 'cid', EDS_OAUTH_CLIENT_SECRET: 'secret' };
    const t1 = await getServiceToken(env, 1000);
    const t2 = await getServiceToken(env, 2000); // within cache window → no refetch
    expect(t1).toBe('minted');
    expect(t2).toBe('minted');
    expect(fetch).toHaveBeenCalledOnce();
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe('https://ims-na1.adobelogin.com/ims/token/v3');
    expect(opts.body.get('grant_type')).toBe('client_credentials');
    expect(opts.body.get('scope')).toContain('aem.frontend.all');
  });

  it('re-mints after the cached token expires', async () => {
    fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ access_token: 'minted', expires_in: 86400 }) });
    const env = { EDS_OAUTH_CLIENT_ID: 'cid', EDS_OAUTH_CLIENT_SECRET: 'secret' };
    await getServiceToken(env, 0);
    await getServiceToken(env, 86400 * 1000); // past expiry minus buffer
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/mcp/service-token.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```js
// src/mcp/service-token.js
const IMS_TOKEN_URL = 'https://ims-na1.adobelogin.com/ims/token/v3';
const DEFAULT_SCOPES = 'openid,AdobeID,aem.frontend.all,additional_info.projectedProductContext,read_organizations';

// Cached in-isolate; survives across requests in the same Worker isolate.
let cached = { token: null, expiresAt: 0 };

/**
 * Resolve the service bearer token used for DA Admin + Helix calls.
 * - PUBLISH_WORKFLOW_SERVICE_TOKEN set (Phase 1 / local) → used verbatim.
 * - Otherwise mint a technical-account token via OAuth Server-to-Server
 *   (client_credentials) and cache it until 5 minutes before expiry.
 * @param {object} env
 * @param {number} now - injectable clock for tests (defaults to Date.now())
 */
export async function getServiceToken(env, now = Date.now()) {
  if (env.PUBLISH_WORKFLOW_SERVICE_TOKEN) return env.PUBLISH_WORKFLOW_SERVICE_TOKEN;
  if (cached.token && now < cached.expiresAt) return cached.token;

  const resp = await fetch(IMS_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: env.EDS_OAUTH_CLIENT_ID,
      client_secret: env.EDS_OAUTH_CLIENT_SECRET,
      scope: env.EDS_OAUTH_SCOPES || DEFAULT_SCOPES,
    }),
  });
  if (!resp.ok) throw new Error(`Failed to mint service token: ${resp.status}`);

  const data = await resp.json();
  cached = { token: data.access_token, expiresAt: now + (data.expires_in * 1000) - 300000 };
  return cached.token;
}

/** Test-only: clear the in-isolate cache. */
export function __resetServiceTokenCache() {
  cached = { token: null, expiresAt: 0 };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/mcp/service-token.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Document the secrets in wrangler.toml**

Append to the MCP secrets comment block:

```toml
#
# MCP Phase 1.5 (OAuth Server-to-Server — replaces the static token):
#   leave PUBLISH_WORKFLOW_SERVICE_TOKEN UNSET to activate minting
#   npx wrangler secret put EDS_OAUTH_CLIENT_ID       # e.g. 2ce60c64c0424378ae571b1a7b1a005e
#   npx wrangler secret put EDS_OAUTH_CLIENT_SECRET   # from Developer Console → Edge Delivery Services credential
#   # optional: npx wrangler secret put EDS_OAUTH_SCOPES   # defaults to the EDS scope set
```

- [ ] **Step 6: Commit**

```bash
npm run lint
git add src/mcp/service-token.js test/mcp/service-token.test.js wrangler.toml
git commit -m "feat(mcp): mint service token via OAuth Server-to-Server (Phase 1.5)"
```

## Task 12: Retrofit `da-client` + `publish-client` to use `getServiceToken`

**Files:**
- Modify: `src/mcp/da-client.js`, `src/mcp/publish-client.js`
- Test: existing `test/mcp/da-client.test.js`, `test/mcp/publish-client.test.js` (still pass — they pass a static `PUBLISH_WORKFLOW_SERVICE_TOKEN`, which short-circuits)

- [ ] **Step 1: Update `src/mcp/da-client.js`**

Add the import and make `authHeaders` async:

```js
import { getServiceToken } from './service-token.js';

async function authHeaders(env) {
  const token = await getServiceToken(env);
  return { Authorization: `Bearer ${token}`, Accept: 'application/json' };
}
```

Then `await` it at the call sites. In `readRequestsSheet` and `fetchWorkflowConfig`, replace `{ headers: authHeaders(env) }` with `{ headers: await authHeaders(env) }`. In `writeRequestsSheet`, replace the inline header with:

```js
  const token = await getServiceToken(env);
  const resp = await fetch(sheetUrl(org, site), {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
```

- [ ] **Step 2: Update `src/mcp/publish-client.js`**

```js
import { getServiceToken } from './service-token.js';

async function authHeaders(env, extra = {}) {
  const token = await getServiceToken(env);
  return { Authorization: `Bearer ${token}`, ...extra };
}
```

Then `await` it at each call site: `headers: await authHeaders(env)` (and `await authHeaders(env, { 'Content-Type': 'application/json' })` in `bulkPublishContent`).

- [ ] **Step 3: Run the affected suites — they must still pass unchanged**

Run: `npx vitest run test/mcp/da-client.test.js test/mcp/publish-client.test.js test/mcp/tools.read.test.js test/mcp/tools.request.test.js test/mcp/tools.approve.test.js`
Expected: PASS — the tests pass `PUBLISH_WORKFLOW_SERVICE_TOKEN: 'svc'`, so `getServiceToken` returns it without minting and all prior assertions (URLs, `Bearer svc`) hold.

- [ ] **Step 4: Full suite + lint + commit**

Run: `npm test`

```bash
npm run lint
git add src/mcp/da-client.js src/mcp/publish-client.js
git commit -m "refactor(mcp): route DA + publish auth through getServiceToken"
```

- [ ] **Step 5: Cut over in production**

After the owner has granted the Technical Account Email write access on the test site:
```bash
npx wrangler secret delete PUBLISH_WORKFLOW_SERVICE_TOKEN   # stop using the user token
npx wrangler secret put EDS_OAUTH_CLIENT_ID
npx wrangler secret put EDS_OAUTH_CLIENT_SECRET
npm run deploy
```
Re-run the Task 10 Step 5 curl smoke-test and the Step 7 e2e checklist to confirm the minted identity has access.

---

## Self-review notes (for the implementer)

- **Spec coverage:** §6 tools → Tasks 7–9; §7b service-auth → Tasks 1 & 3 & 6 (service token) + Task 1 (shared secret); pluggable notification → reusing `src/email.js` `sendEmail` (Task 2); test-site registration + verbal-confirm skill → Task 10; backwards-compat → Task 2 keeps `/api/*` green + Task 10 Step 7 check.
- **Out of scope here (Phase 2, do NOT build now):** IMS-token forwarding, per-user authz, the da-agent `destructiveHint→needsApproval` patch, moving to `aem-agentic-plugins`, reverting the worker relaxations. The `annotations` are emitted now (harmless) so Phase 2 needs no tool changes.
- **Type/name consistency:** tool handler arg names (`userEmail`, `authorEmail`, `approverEmail`, `paths`, `path`) are used consistently across `tools.js` and the skill. `readRequestsSheet`/`writeRequestsSheet`/`fetchWorkflowConfig` (da-client), `resolveApproversAndCc`/`filterPendingForApprover`/`removeRowsForPaths`/`appendRequestRow` (workflow), `publishContent`/`bulkPublishContent`/`pollJobStatus` (publish-client) are referenced with the same signatures everywhere.
- **Note on `bulkPublishContent`/`pollJobStatus`:** built in Task 6 and unit-tested, but the Task 9 `approve_request` handler uses per-path `publishContent` for simplicity in the POC. Switching to bulk for large approvals is a safe follow-up; the client is ready.

---

## Appendix — Skills-only variant (PARKED — revisit later, do NOT build now)

> **Status:** Footnote / open decision. Not part of the delivery path. Revisit only if we explicitly want a comparison experiment. No task, no code in this plan.

We considered whether the workflow could be done with a **skill only** — no MCP server — driving da-agent's *existing* built-in tools. Recording the analysis here so the decision isn't re-litigated from scratch.

**What a skill could do** (using `content_read`/`content_update` on `/.da/publish-workflow-requests.json` and the EDS preview/publish tools):
- "list pending" → `content_read` the sheet; the model filters in prose.
- "approve" → EDS publish + `content_update` to remove the row.
- "request" → `content_update` to append a pending row.

**Why it is incomplete (not merely brittle):**
- **It cannot send any notification email.** da-agent has no HTTP/email tool, and the worker's `/api/*` is unreachable from a skill. Notifying approvers/authors is the *entire point* of request-publish — so a skills-only build delivers the plumbing with the payload missing.
- **Approver resolution would run in the model's head.** Specificity matching + DL-group expansion decide *who may approve a publish*; a wrong result is a governance/security failure, not a cosmetic bug.
- **Sheet corruption risk.** Read-modify-write of a structured multi-tab JSON sheet via `content_update` in prose can drop columns or lose concurrent edits.

**The only honest reasons to build it later:**
1. **Comparison experiment** — demonstrate the gap firsthand to justify the MCP investment.
2. **Zero-deploy mechanics demo** — show list/approve *motions* in chat with no worker deploy, explicitly accepting no-email + brittleness.

**If we revisit and decide yes**, the scope would be: a single skill `.md` (installed to the test site `.da/skills/`) that instructs the agent to use the built-in `content_*`/EDS tools for the list/approve/request-without-email motions, plus a manual e2e checklist — and a loud "experiment, not a delivery path; cannot notify" banner. No worker code, no new tools.

**Decision owner:** Sagar. **Trigger to revisit:** a stakeholder asks "why not just a skill?" or we want a throwaway demo before the MCP worker is ready.
```
