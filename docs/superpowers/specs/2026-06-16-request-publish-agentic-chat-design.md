# Request-Publish in Chat Mode — Agentic Integration Design

- **Date:** 2026-06-16
- **Author:** Sagar Sane (ssane@adobe.com)
- **Status:** Approved (Design A committed; Design B explored, deferred to Phase 4)
- **Topic:** Make the request-publish workflow usable agentically inside da-nx Chat mode (da-agent / agent.da.live)

---

## 1. Background

Request-publish today is three components:

| Component | Role | Location |
|---|---|---|
| `request-for-publish` plugin | Author UI: submit a request | `aem-apps/tools/plugins/request-for-publish/` |
| `publish-requests-inbox` app | Approver UI: review / approve / reject | `aem-apps/tools/apps/publish-requests-inbox/` |
| `publish-requests-worker` | **Stateless email relay only** | `cloudadoption/codebase/publish-requests-worker/` |

Key facts (from research):

- **State lives in a DA Sheet**, not the worker: `/.da/publish-workflow-requests.json` (`requester, approver, path, comment, status, created`). `status` is always `pending`; the row is **deleted** on approve/reject.
- **Config lives in DA Config tabs**: `publish-workflow-config` (pattern → approvers/CC), `-groups-to-email` (DL expansion), `-settings` (e.g. `comments.required`, `cc.can-approve`).
- The **frontends do the real work**: sheet I/O, Helix Admin preview/publish (incl. bulk + job polling), config resolution (**specificity matching** + **DL group expansion**), rule enforcement. The worker only sends three emails: `/api/request-publish`, `/api/notify-rejection`, `/api/notify-published`, authenticating a DA JWT with `client_id === 'darkalley'` ([index.js:73](../../../../../cloudadoption/codebase/publish-requests-worker/src/index.js)).

Chat mode (the target):

- **da-nx chat block** (`da-nx/nx2/blocks/chat/`) — UI. Already forwards `mcpServers` + headers (from site config) and the user's IMS token to da-agent; renders tool cards, **approval cards**, and `:::directive` rich UI. Chat IMS `client_id` = **`nexter`** ([nx2/scripts/scripts.js:28](../../../../da-nx/nx2/scripts/scripts.js)).
- **da-agent** — CF Worker, Claude Sonnet 4.6, Vercel AI SDK. Extends via skills, agent presets, MCP servers (site-registered or built-in), built-in tools. Forwards the IMS token to MCP servers **only if** the URL matches `TRUSTED_MCP_DOMAINS` = `*.adobe.io,*.adobe.net,*.adobe.com`. `needsApproval` exists **only** on built-in tools; the MCP tool-adapter does **not** gate MCP tools.
- **aem-agentic-plugins** (`adobe-rnd/aem-agentic-plugins`) — currently **empty**. Purpose: "Agentic plugins, MCP tools, Skills for EDS." The official home once productized.
- **ew-extensions** — the EW shell extension framework; its **Skills Editor** (`da-skills`, a frontend EDS project) registers skills/agents/MCP servers into a site's config. Registration surface, **not** a runtime host.

---

## 2. Goals / Non-goals

**Goals**
- Drive the **full lifecycle for both personas** (author request; approver list/approve/reject) from natural-language chat.
- **Backwards compatible**: the plugin, inbox app, and worker keep working; `/api/*` untouched.
- **State stays in sync** with the existing UIs with no reconciliation mechanism.

**Non-goals (committed design)**
- "Invite an approver from chat" → **Phase 3**.
- Rich inline diff → **Phase 3** (committed design returns preview/live URLs).
- Consolidating the duplicated logic between the inbox app and the MCP server → deferred.
- Chat-native / email-less model → explored in §9, **Phase 4 conditional**.

---

## 3. Locked decisions

| Decision | Choice | Rationale |
|---|---|---|
| Scope | Both personas, full lifecycle | One reusable surface, not two bolt-ons. |
| Mechanism | **Coarse/atomic MCP tools + a thin skill** | MCP for correctness-critical verbs (incl. the one thing skills *cannot* do — call the email worker); skill for NL intent-mapping. See §8. |
| MCP host | **Phase 1 (POC):** `/mcp` on existing **`publish-requests-worker`**. **Phase 2:** extract to **`aem-agentic-plugins`** on a trusted Adobe domain. | Fastest POC (reuses auth+email+KV); aem-agentic-plugins is the official home. ew-extensions ruled out (frontend, no backend). |
| POC strategy | **Zero da-agent changes** — prod `agent.da.live`; MCP at `publish-requests-worker/mcp`; **service-auth, no per-user authz, no approval card** | da-agent (`TRUSTED_MCP_DOMAINS`, approval patch) can't be touched this week. **Test-site only**; Phase 2 restores all three. See §7b. |
| Email | **Reuse `publish-requests-worker`** | Single source of email truth; worker + plugin/app untouched. |
| Granularity | **Coarse / atomic** | Each tool is a complete transaction; the model decides *what/when* but cannot half-complete a workflow. |
| Registration | **Site-scoped** config (`mcp-servers` row) via the Skills Editor | Per-site opt-in; no da-agent registration code. |

---

## 4. Architecture (target state; POC delta in §7b)

```
Author / Approver ── "request approval for this page" / "what's in my queue?"
        │
        ▼
  da-nx chat block (UI, unchanged)
        │  POST /chat { messages, imsToken(nexter), mcpServers }
        ▼
  da-agent (Claude + Vercel SDK)          ✏️ Phase 2: destructiveHint → needsApproval
        │  connects + forwards IMS token (Phase 2: trusted domain only)
        ▼
  publish-workflow MCP server   🆕  (POC: in worker · Prod: aem-agentic-plugins)
  list_pending · get_request_details · get_approvers · request_publish · approve · reject
        │                  │                       │
        ▼                  ▼                       ▼
   DA Admin           Helix Admin           publish-requests-worker
   sheet + cfg        preview/publish        (email only)
        │  ▲
        │  └─ SAME DA Sheet = single source of truth ──┐
        ▼                                              ▼
   existing request-for-publish plugin + inbox app (unchanged; in sync for free)

  Registration plane (not runtime): ew-extensions "Skills Editor" registers the MCP
  server + installs the skill + agent preset into a site's config.
```

**Component boundaries (each independently testable):**
- **MCP server** — orchestration brain: coarse tools, ported specificity-matching + DL-group-expansion, rule enforcement, transaction ordering. Stateless beyond the DA Sheet.
- **publish-requests-worker** — email arm (+ POC host for `/mcp`). Still serves the plugin/app.
- **da-agent** — unchanged in POC; one small approval enhancement in Phase 2.
- **da-nx chat / plugin / app** — unchanged.

---

## 5. Identity & auth

**Target (Phase 2):** chat sends the user's IMS token (`nexter`) → da-agent forwards it to the MCP server **because it is on a trusted Adobe domain** → the MCP server reuses that bearer for DA Admin (sheet+config), Helix Admin (preview/publish), and the worker. DA Admin + Helix already accept the `nexter` token (da-agent's built-in tools prove it), so per-user identity flows end to end — required because **approval authorization depends on who the user is**. Worker change: relax `client_id` to `['darkalley','nexter']` for the forwarded token.

**POC (Phase 1):** the token is *not* forwarded (workers.dev is untrusted), so the MCP server self-authenticates with a service credential and per-user authz is dropped. Full detail in §7b.

---

## 6. Tool surface (coarse / atomic)

All tools take `org`/`site` (+ `paths`); the skill fills them from `pageContext`. Gated-tool results include a `humanReadableSummary` field, which the approval card surfaces.

| Tool | Persona | Gated? | Transaction (server-side, atomic) |
|---|---|---|---|
| `list_pending_requests` | Approver | read-only | Reads sheet; filters to requests the user can approve (specificity + DL expansion + `cc.can-approve`). Ports `getAllPendingRequestsForUser`. |
| `get_request_details` | Both | read-only | Requester, resolved approvers, comment, status, **preview + live URLs**. |
| `get_approvers_for_path` | Both | read-only | "Who would be notified for path X" — deduped approvers+CC after expansion. Ports `getApproversForPath`. Enables disambiguation before a gated action. |
| `request_publish` | Author | **gated** | resolve approvers/CC → enforce rules → reject duplicate pending → preview → write row(s) → **notify** approvers+CC. |
| `approve_request` | Approver | **gated** | authorize per path → publish (single, or **bulk + job-poll ≤60s**) → remove succeeded rows → **notify** author(s), consolidated. Returns published + failures. |
| `reject_request` | Approver | **gated** | authorize → remove row → **notify** author + DigiOps with reason. |

*Phase 3: `invite_approver`.*

- **Approval gating:** gated tools advertise MCP `annotations: { destructiveHint: true }`, reads `readOnlyHint: true`. The Phase-2 da-agent enhancement (§7a) maps `destructiveHint → needsApproval` → the chat renders its approval card. (Not active in the POC — see §7b.)
- **Atomic/partial:** bulk `approve_request` mirrors the app — succeeded paths removed + authors notified, failures stay pending and are reported. No tool leaves the sheet and published state inconsistent.
- **Pluggable notification (bridge to §9):** the **notify** steps sit behind one `NotificationChannel` interface; the implementation calls `publish-requests-worker`. Isolates the only assumption Design B would change.
- **Intent mapping (skill's job):** map varied phrasings — "request approval", "send for sign-off", "ready to publish" → `request_publish`; "what's in my queue?", "approve the homepage", "reject this" → the approver tools. The skill fills `org`/`site`/`path` from `pageContext`, asks for a comment when required, and previews via `get_approvers_for_path` before a gated action.

---

## 7. Cross-repo changes

| Repo | Change | Type |
|---|---|---|
| MCP host (P1: **publish-requests-worker**; P2: **aem-agentic-plugins**) | `publish-workflow` MCP server (6 tools) + `skills/request-publish/skill.md` + `agents/publish-workflow.json` preset. | **NEW** |
| **publish-requests-worker** | **P1:** host `/mcp` alongside `/api/*`; accept a **service identity / MCP↔worker shared secret** on `/mcp`; skip the per-user write-permission check (test-site only). **P2:** relax `client_id` → `['darkalley','nexter']`; revert P1 relaxations. | **MODIFY** |
| **da-agent** | MCP tool-adapter honors `annotations.destructiveHint → needsApproval`. **P2 only** (POC uses prod unchanged). | **MODIFY** (small) |
| **da-nx chat / plugin / app** | — | **NONE** |
| **ew-extensions (Skills Editor)** | Registers the MCP server + installs skill + preset. Cannot **host** it (frontend EDS project, no worker runtime). | **NONE (usage)** |

### 7a. da-agent change — exact detail (Phase 2)

Approval is the Vercel AI SDK's native `needsApproval` tool option; the continuation machinery ([tool-approval.ts](../../../../da-agent/src/tool-approval.ts), [message-pipeline.ts](../../../../da-agent/src/message-pipeline.ts)) is tool-agnostic. Only the MCP adapter must opt tools in — **~6 lines, two files**:

1. **[client.ts](../../../../da-agent/src/mcp/client.ts):** add `annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean }` to `MCPToolDefinition` (`listTools()` already passes the raw array through).
2. **[tool-adapter.ts](../../../../da-agent/src/mcp/tool-adapter.ts) `mcpToolToAITool`:** `needsApproval: async () => mcpTool.annotations?.destructiveHint === true`.

**Explicit opt-in:** no annotation → no gate (preserves behavior for other MCP servers; the spec's default-`true` would make every annotation-less server start prompting). Our server sets the hints explicitly.

### 7b. POC posture — zero da-agent changes (Phase 1)

The POC uses **prod `agent.da.live`** (no fork, no patch, no env change). The MCP server is hosted at **`publish-requests-worker/mcp`** (workers.dev), registered in a **test site's config**; da-nx forwards it and prod da-agent connects. Two consequences, **accepted for the test-site POC only**:

1. **No forwarded token → service auth, no per-user authz.** da-agent attaches the user's `Authorization` only for trusted domains ([tool-assembly.ts:83-98](../../../../da-agent/src/tool-assembly.ts)); workers.dev is untrusted, so no token arrives. The MCP server uses its **own credential** (a dev IMS token in a worker secret — fastest; or an IMS technical account) with content-write access to the **test** org/site, for DA Admin + Helix + worker calls. Authorization ("may *this* person approve") cannot be enforced. Do **not** fake identity via a static header secret.
2. **No approval card → gated tools run automatically.** Mitigate with: a **skill that confirms verbally** before gated tools (soft), an optional **in-tool confirm-token** two-step (server-side, stronger), and a **test org/site + test approver emails** blast radius.

**Worker relaxations (test-site only):** `/mcp` accepts the service identity / shared secret and skips the per-user `admin.hlx.page` permission check. **Transport:** `/mcp` speaks Streamable HTTP (2025-03-26), SSE fallback ([client.ts](../../../../da-agent/src/mcp/client.ts)).

> ⚠️ **Confused-deputy warning.** Here the MCP server wields service-level write power on behalf of *any* chat user, with no per-user authz. Acceptable only for a throwaway **test** org/site. **Phase 2 is the hard gate** that restores token forwarding + authorization before any real content.

---

## 8. Why not skills-only (decision record)

| Operation | Existing da-agent tool? |
|---|---|
| Read sheet / config | ✅ `content_read` (the sheet *is* DA content) |
| Write / remove a row | ⚠️ `content_update` — read-modify-write on a structured JSON sheet; model can corrupt format |
| Preview / publish | ✅-ish EDS tools (single); ❌ bulk + job-poll |
| Resolve approvers (specificity + expansion) | ❌ no tool — business logic in prose |
| **Send notification emails** | ❌ **no tool at all** |

1. **Pure skills-only is impossible, not just brittle** — nothing in da-agent can call the email worker (generated-tools can't either; sandbox is a stub), and notifying approvers is the whole point.
2. **The parts skills *could* do are the wrong parts to trust to prose** — approver resolution decides *who may approve*; a wrong result is a governance failure. Atomic state + authz are correctness-critical and deterministic.

Conclusion: **MCP for the verbs, skill for the conversation.** The skill does real work (intent-mapping, context-filling, preview-before-act); the deterministic and impossible-without-a-tool parts live in code.

---

## 9. Alternative explored — chat-native / email-less (Phase 4 conditional)

**Concept.** Approval through in-product surfaces, not email: request → row written (no email); approver is signalled in-product and approves in-chat.

**Key finding — A and B share the tool layer and state machine.** "Email-less" changes only the **notification transport** (+ adds an in-product signal surface), so B **reuses §6's tools** and differs only in: (1) the pluggable `NotificationChannel` points elsewhere; (2) a presence surface (EW badge/inbox, or richer in-chat directives) is added.

**The question B must answer: what replaces email as the signal?** Pull-only (approver must remember to ask — poor UX), in-product push (EW badge/inbox, Slack/Teams via MCP, browser push — must be built), or agent-initiated push (impossible — the agent only runs during a chat turn).

| | A (committed) | B (chat-native) |
|---|---|---|
| Reaches approvers not in chat | ✅ email | ❌ unless a channel is built |
| Loop speed | good | ✅ tighter |
| Audit / compliance record | ✅ email trail | ❌ must be built |
| External / cross-org approvers | ✅ | ❌ hard |
| Build cost / presence assumption | low / none | higher / requires approvers in EW |

**Open product questions:** transport if not email? do approvers live in EW/chat or only get pulled in by email? is an audit record required? how are external approvers reached? **Recommendation:** treat B as **additive** (in-product *plus* email), enabled cheaply by the pluggable `NotificationChannel`. Don't commit until the questions are answered; if pursued it earns its own brainstorming → spec cycle.

---

## 10. Phasing

- **Phase 1 — POC (zero da-agent changes):** `/mcp` on `publish-requests-worker` (Streamable HTTP) with **service auth + relaxed checks**; the 6 tools (read-only three + `request_publish` first, then `approve_request`); `request-publish` skill (verbal-confirm) + agent preset; registered in a **test site** against **prod `agent.da.live`**; test approver emails. **No per-user authz, no approval card** (mitigated per §7b).
- **Phase 1.5 — Service identity (fast-follow):** replace the pasted user token with a **technical-account** token minted from the Adobe Developer Console *Edge Delivery Services* OAuth Server-to-Server credential (`aem.frontend.all` scope), via a `getServiceToken` seam. The technical account is granted write access on the test site. Removes the ~24h re-paste; still no per-user identity (that's Phase 2).
- **Phase 2 — Hardening (the hard gate). Three deliverables:**
  1. **Add back IMS-token forwarding** — move the MCP server to a more official home on a trusted Adobe domain (**aem-agentic-plugins**), so prod da-agent forwards the user token; restore the worker `client_id` allow-list and revert the POC relaxations.
  2. **Restore per-user authorization** — enforce "may this person approve" using the forwarded identity.
  3. **Add the `/chat` approval gate** — upstream the §7a da-agent patch so gated tools render the real human-in-the-loop approval card.
  Registration via the Skills Editor; notification = email via the pluggable `NotificationChannel`.
- **Phase 3 — Features:** `invite_approver`; rich inline diff via `:::directive`.
- **Phase 4 — Conditional:** chat-native notifications per §9, pending product answers.

---

## 11. Risks & dependencies

1. **[Phase 2] Trusted Adobe domain for the MCP server.** Required for token forwarding → per-user authz. Needs ops/DNS. The Phase-1 POC sidesteps it with service auth on a test site.
2. **[Phase 2] da-agent approval enhancement (§7a) must land upstream.** Cross-team PR + deploy. The Phase-1 POC accepts no approval card (mitigated per §7b).
3. **Logic duplication / drift.** The inbox app's `api.js` and the MCP server both encode schema + matching + expansion. Accepted now; later consolidation into a shared module is a candidate.
4. **Concurrent sheet writes.** Read-modify-write JSON → lost-update risk; pre-existing between app users, chat adds a third writer. Optional mitigation: conditional writes (ETag/If-Match) in the MCP server.
5. **Contract conformance.** State stays in sync only if the MCP server matches the exact sheet schema/semantics + resolution logic. Central correctness requirement.

---

## 12. Testing strategy

- **MCP server units:** specificity matching, DL expansion, rule enforcement, sheet read-modify-write, bulk job-poll, partial-failure reporting — fixtures mirroring the inbox app (parity tests).
- **NotificationChannel:** mocked worker; assert payloads to `/api/request-publish|notify-rejection|notify-published`.
- **Auth (Phase 1):** `/mcp` accepts the service identity / shared secret, rejects anonymous; service credential reaches DA Admin + Helix on the test site.
- **Auth (Phase 2):** token forwarding (trusted vs untrusted); worker client_id allow-list; per-user authz enforced.
- **Approval gate (Phase 2):** `destructiveHint` → card raised; `readOnlyHint` → no gate.
- **Cross-surface sync:** create in plugin → visible in `list_pending_requests`; approve in chat → gone from inbox app; approve in app → gone from chat.
- **Backwards compat:** existing plugin/app/worker flows unchanged.
