# Request-Publish — Implementation Plan

> **Status (2026-06-23):** Phases 1, 1.5, and 2 (Tasks A–C) complete; **App and Plugin both verified against `-ci`.** `publish-requests-worker` is the single source of truth; App, Plugin, and (POC) MCP all run on its logic. **Next:** merge the REST layer to `main` and retire the `mcp` branch (see Release), then re-home `/mcp` into `aem-agentic-plugins`.

Spec: [docs/superpowers/specs/2026-06-16-request-publish-agentic-chat-design.md](../specs/2026-06-16-request-publish-agentic-chat-design.md)

---

## Done

### Phase 1 + 1.5 — MCP POC ✅ (`mcp` branch, `publish-requests-worker`)

Stateless MCP (`/mcp`, JSON-RPC over Streamable HTTP) on the worker; 7 tools (`list_pending_requests`, `get_request_details`, `get_approvers_for_path`, `request_publish`, `approve_request`, `reject_request`, `withdraw_request`); callable from da-nx Chat via the `publish-workflow` preset + `request-publish` skill.

- **Publish/preview** run via da-agent built-in `content_publish`/`content_preview` (the user's IMS session) — the worker **never publishes**.
- **Phase 1.5:** service token minted via OAuth S2S (`client_credentials`, auto-refresh); `getServiceToken` seam in `src/mcp/service-token.js`.
- **POC limitation:** MCP identity is **caller-supplied** (`authorEmail`/`approverEmail`/`userEmail`) — a workflow-state/notification/disclosure IDOR (content still can't go live without an IMS-gated `content_publish`). **Closed by the Phase 2 move below**, not by separate hardening.
- **Site assets** (manually uploaded to the test site): `mcp-assets/` skill, agent preset, `mcp-servers` row.

### Phase 2 Tasks A–C — Worker as single authority ✅

Consolidated the logic that was duplicated across app / plugin / MCP (specificity matching, DL-group expansion, sheet I/O, approver resolution) into one place.

- **Task A — REST layer on the worker** (`mcp` branch): additive, resource-style endpoints next to the legacy email-only ones (which are left untouched for the customer's old copy):
  - `GET /api/requests` (+`?role=requester`), `GET /api/approvers`, `GET /api/config`
  - `POST /api/requests` (+`{resend:true}`), `POST /api/requests/approve|reject|withdraw`
  - Identity **derived from the IMS profile** via the forwarded user token (no IDOR); `checkAdminStatus` + registration gates (parity with legacy). Shared `src/mcp/operations.js` — MCP tools **and** REST handlers both delegate to it. Page-existence + org/site binding via `pageExists`. **186 tests, lint clean.**
- **Task B — App** (`publish-requests-inbox`) is a thin REST client; Helix publish/preview stay client-side. Committed (`d381bad`); **✅ verified against `-ci`**.
- **Task C — Plugin** (`request-for-publish`) is a thin REST client. Committed (`450a559`); **✅ verified against `-ci`**.

App/Plugin READMEs updated to the thin-client model.

---

## Release: merge the REST layer to `main`, retire the `mcp` branch

**Not a breaking change.** The legacy `/api/request-publish` + `/api/notify-*` handlers are **byte-unchanged** from `main` (verified — no diff lines touch them); the new endpoints are additive. So one worker serves the legacy app/plugin (and the customer) **and** the new app/plugin at the same time — no atomic app+plugin+worker merge, just **deploy order** (worker first; the new app/plugin depend on the new endpoints). The legacy app/plugin stay put and keep working unchanged.

**No "v2" worker needed.** A side-by-side v2 protects *incompatible* consumers; there's no incompatibility here, so v2 would be two near-identical deployments of the same repo and would fork/freeze the customer's worker. Avoid it.

**Config-free to ship.** The REST layer uses the user's forwarded token + existing KV/email config — **no new prod secret**. (`getServiceToken`/OAuth and `MCP_SHARED_SECRET` are MCP-only and never on the REST path — `getServiceToken` has zero refs in `index.js`.)

**The `mcp` branch is a misnomer once `/mcp` moves out** — what remains is the REST / worker-as-single-authority work. Sequence (new session):

1. **Preserve the MCP POC:** branch the current `mcp` tip as **`mcp-poc`**. This is the source material to port into the `aem-agentic-plugins` bundle, and a deployable POC during the transition. (Git history has it regardless; a named ref is convenient.)
2. **Strip `/mcp` on the branch:** remove `tools.js`, `transport.js`, the `/mcp` route in `mcp/index.js`, `auth.js` (`x-mcp-secret`), `service-token.js`, `mcp-assets/`. Keep `operations.js`/`workflow.js`/`da-client.js` (the REST core) — ideally lift out of `src/mcp/` into e.g. `src/workflow/`. Confirm the REST/email tests stay green.
3. **Rename:** `git branch -m mcp rest-api`.
4. **PR `rest-api` → `main`** (deploys to the prod worker; legacy unaffected). Then the new App/Plugin (aem-apps `agentic-request-publish` branch) can go live pointing at prod — today they need `?env=ci`.

**What comes off vs. stays:** the MCP-specific files (tool defs, transport, `x-mcp-secret` gate, service token, assets) are exactly what gets re-expressed as **thin tools in the `aem-agentic-plugins` bundle**. The orchestration (`operations.js`) and pure logic (`workflow.js`) **stay on the worker** — the bundle calls them over HTTP, it does not import them.

---

## Next: re-home `/mcp` into `aem-agentic-plugins` (thin wrapper)

**Decided (2026-06-23):** the MCP surface moves out of `publish-requests-worker` into the `aem-agentic-plugins` aggregator as a `publish-workflow` **bundle of thin tools** that forward the user token and call the REST layer. No orchestration in the bundle. **Locked assumption:** the `aem-agentic-plugins` worker is whitelisted to forward the IMS token to `publish-requests-worker`.

```
 App (approve)   Plugin (request)        Chat
      │  Bearer(user)  │           da-agent ──Bearer(user)──▶ aem-agentic-plugins /mcp
      └────────┬───────┘                                      publish-workflow bundle
               ▼                                               (thin tools: args → REST)
     publish-requests-worker  ◀───────── Bearer(user) ────────────────┘
        REST + email (single authority)
               │
        DA Admin (user token) · Email   (worker never publishes)
```

**Why this shape:** one orchestration, one identity model. The MCP path inherits the REST layer's token-derived identity → the Phase-1 IDOR closes with no separate hardening, and the worker's **service credential is eliminated** (`EDS_OAUTH_CLIENT_ID/SECRET` dropped once every DA call uses the user token). Cost: one extra CF→CF hop on the Chat path; the bundle is coupled to the REST contract.

**Interim auth (OAuth S2S) until IMS forwarding is proven.** The thin-client bundle is **user-token by design** — it calls the user-token-only REST endpoints (`darkalley`-validated; identity from the IMS profile; they reject the OAuth S2S service token). There is no "OAuth-S2S thin bundle." So the cutover is **build-and-prove, then switch**:

- **Keep the existing OAuth-S2S `/mcp` (on `mcp-poc` / `-ci`) as the live MCP path.** Nothing about the working path changes until the new one is proven.
- Build the bundle and verify Steps 1 + 3 (bundle reads the inbound token; da-agent forwards it on a trusted domain) **end-to-end against `-ci`** — this verification *is* "confirming IMS token forwarding works."
- **Only then** cut over Chat to the bundle and decommission: remove the `mcp-poc` `/mcp`, drop the worker's `EDS_OAUTH_CLIENT_ID/SECRET`. Until that point, the service credential stays.

### Steps (build + prove the user-token bundle; cut over last)

1. **Verify the bundle can read the caller's bearer token.** `aem-agentic-plugins` capabilities receive per-request config via `env`, but the user's IMS token arrives as the request's `Authorization` header. Confirm the tool-handler runtime exposes the incoming request/headers to handlers; if not, extend the framework (`src/app.js` / `src/lib/registry.js`) to thread the inbound `Authorization` through to capability handlers. **This is the gating unknown.**
2. **Build the `publish-workflow` bundle** under `src/plugins/publish-workflow/`:
   - `plugin.json` manifest.
   - `tools/*.tool.js` — thin tools mapping ~1:1 to REST endpoints (`request_publish`→`POST /api/requests`, `list_pending`→`GET /api/requests`, `get_approvers`→`GET /api/approvers`, `approve`/`reject`/`withdraw`→`POST /api/requests/*`, `get_request_details`→`GET /api/requests` + find). Each forwards `Authorization: Bearer <user>` and returns the REST response as the tool result. **No DA/email/sheet access.**
   - `skills/request-publish/SKILL.md` — port `mcp-assets/request-publish.md` to the bundle's SKILL format.
   - Worker base URL as an `env` var on the aem-agentic-plugins worker.
3. **Trusted domain + token forwarding (da-agent side).** da-agent already forwards `Authorization: Bearer <imsToken>` (+ `x-api-key`) to MCP servers whose URL is in `TRUSTED_MCP_DOMAINS` (`src/tool-assembly.ts`; gate in `src/mcp/token-allowlist.ts`). Add the `aem-agentic-plugins` domain to that allowlist so the user token reaches the bundle. (The bundle then forwards it to the worker, which is the locked whitelisting assumption.)
4. **`/mcp` is already removed from the worker at release** (see the Release section — stripped when `mcp` → `rest-api`). The `mcp-poc` branch holds the source to port. Once the bundle is the only MCP path, drop the worker's OAuth service credential.
5. **Verify, then cut over (the gate).** Point a test site's `mcp-servers` config at the bundle's `/mcp` and run the Chat lifecycle (request → list → approve/reject/withdraw) end-to-end against `publish-requests-ci`, confirming the **user token** flows da-agent → bundle → worker and identity is derived from it. Only once that passes: switch Chat off the OAuth-S2S `/mcp` and decommission it + drop the service credential. Until then, the OAuth-S2S `/mcp` remains the live path.

---

## Remaining da-agent items (independent of the move)

- **D1 — Inject `userEmail` into the system prompt** (`da-agent/src/prompt-builder.ts`, pageContext block). Universal nicety (skills stop asking "what's your email?"). Lower priority now that the worker derives identity from the token.
- **D3 (worker half) — Scope tools to the opened site.** da-agent half **done** (`fix/scope-content-tools-to-opened-site`: built-in content tools reject `org`/`repo` ≠ opened site). Worker half **TODO:** da-agent forwards opened-site context (`x-da-page-org`/`x-da-page-site`, server-set, trusted-domain-gated like the IMS token), and the worker validates `arg.org`/`arg.site` against it in state-changing tools. `pageExists` already rejects non-existent/wrong-triple pages; the header check adds the *current-site* binding existence alone can't (another real site would still pass `pageExists`).

---

## Immediate next action (new session)

The **Release** sequence above: `mcp-poc` branch → strip `/mcp` → rename `mcp` → `rest-api` → PR to `main`. (App + Plugin already verified against `-ci`.)
