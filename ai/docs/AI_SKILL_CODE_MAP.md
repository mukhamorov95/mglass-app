# AI Skill → Code Map

**Project:** mglass-app  
**Updated:** 2026-06-02  
**Status:** Architectural / Documentation only. No runtime automation connected.

---

## 1. Purpose

This document maps every AI agent, skill, and workflow defined in `ai/` to the **real files already present in the codebase**. It answers three questions for each component:

- Which existing functions/routes can it call?
- Which files must it never touch?
- What is missing before it can run safely?

This is a read-only planning document. Nothing here creates live agent actions.

---

## 2. Current State

| Layer | Status |
|---|---|
| `ai/agents/` | Architecture docs only — 2 of 5 agents documented |
| `ai/skills/` | Directory created, no skill files yet |
| `ai/workflows/` | Directory created, no workflow files yet |
| `ai/tools/tool-registry.ts` | Schema defined, not connected to real functions |
| `ai/memory/` | Directory created; `lib/agentMemory.ts` is the real runtime |
| `ai/policies/` | Safety, approval, and permissions policies documented |
| Cron agents | **4 cron agents already running** in `app/api/cron/agent-*/` — they use `lib/agentMemory.ts` but are **not** connected to `ai/` layer |

---

## 3. Agent-to-Skill Map

| Agent | Main Responsibility | Allowed Skills | Forbidden Actions | Requires Approval For |
|---|---|---|---|---|
| `chief-of-staff-agent` | Orchestrate morning/evening briefings, delegate to other agents | `analyze-crm-day`, `audit-manager-work`, `check-margin` | Send messages to clients, modify CRM, push code | Any action that writes to external systems |
| `sales-director-agent` | Analyze manager performance, suggest scripts | `analyze-crm-day`, `audit-manager-work` | Edit manager deal cards, send messages on behalf of managers | Sharing report with client, changing manager targets |
| `proposal-engineer-agent` | Draft commercial proposals using calculators | `create-commercial-proposal`, `check-catalog-item`, `check-margin` | Send proposal directly, override prices | Sending to client, applying discount > threshold |
| `production-dispatcher-agent` | Check order readiness, create production plan | `check-order-before-production`, `generate-production-plan` | Start production without payment confirmation | Any production order creation |
| `finance-controller-agent` | Monitor margin, flag risky deals | `check-margin` | Change prices, modify deals in CRM | Any pricing override |

---

## 4. Skill-to-Code Map

### `create-commercial-proposal`

| Field | Value |
|---|---|
| **Purpose** | Generate a structured commercial proposal (КП) from calculator output |
| **Existing files to use** | `lib/showerCalculator.ts` · `lib/mirrorCalculator.ts` · `lib/loftCalculator.ts` · `lib/b2bCalculator.ts` · `lib/calcServiceCost.ts` · `lib/saveCalculation.ts` · `app/api/ai/generate-kp/route.ts` |
| **API endpoint** | `POST /api/ai/generate-kp` — Anthropic Claude, reads calculations from Supabase |
| **Existing files to avoid** | `lib/amocrm.ts` (never POST), any route under `app/api/admin/` |
| **Missing dependencies** | No skill `.md` file · No approval gate before send · No proposal draft state |
| **Notes** | `generate-kp` route already uses `ANTHROPIC_API_KEY` and Supabase; skill needs to wrap it with approval check before delivery |

---

### `check-catalog-item`

| Field | Value |
|---|---|
| **Purpose** | Verify that a hardware item exists, has prices, is active |
| **Existing files to use** | `app/admin/shower-hardware/CatalogTab.tsx` (read logic) · Supabase `shower_catalog_items` + `shower_catalog_prices` tables |
| **API endpoint** | No dedicated endpoint; reads via Supabase client |
| **Existing files to avoid** | Direct DB writes without UI confirmation |
| **Missing dependencies** | No skill `.md` file · No read-only API route for catalog lookup · No health check specific to catalog items |
| **Notes** | `lib/healthCheckRunner.ts` could be extended to include a catalog-integrity check |

---

### `check-order-before-production`

| Field | Value |
|---|---|
| **Purpose** | Verify payment confirmed, drawings ready, materials in stock before starting production |
| **Existing files to use** | `app/api/orders/[id]/production-stages/route.ts` · `app/api/orders/[id]/payment/route.ts` · `lib/productionSummary.ts` · `lib/agentMemory.ts` |
| **API endpoint** | `app/api/cron/agent-production/route.ts` — already does similar checks |
| **Existing files to avoid** | `app/api/orders/[id]/approve/route.ts` (approval must be manual) |
| **Missing dependencies** | No skill `.md` file · No structured pre-production checklist schema |
| **Notes** | `agent-production` cron already implements most of this logic; skill should wrap it, not duplicate |

---

### `analyze-crm-day`

| Field | Value |
|---|---|
| **Purpose** | Summarize today's CRM activity: calls, messages, stage moves, stale deals |
| **Existing files to use** | `lib/amocrm.ts` · `lib/salesMonitor.ts` (`collectAllMetrics`, `buildReport`) · `app/api/cron/sales-monitor/route.ts` · `app/api/amo/manager-stats/route.ts` |
| **API endpoint** | `GET /api/cron/sales-monitor` — fires at 18:00 via cron |
| **Existing files to avoid** | Any AmoCRM POST/PATCH — `lib/amocrm.ts` is read-only by design |
| **Missing dependencies** | No skill `.md` file · No per-manager drill-down in current report |
| **Notes** | `buildReport()` already returns a formatted Telegram-ready string; skill wraps this |

---

### `generate-production-plan`

| Field | Value |
|---|---|
| **Purpose** | Build a daily production schedule from active paid orders |
| **Existing files to use** | `lib/productionSummary.ts` · `app/api/orders/production/route.ts` · `app/api/cron/agent-production/route.ts` · `lib/agentMemory.ts` |
| **Existing files to avoid** | `app/api/orders/[id]/brigade/route.ts` (brigade assignment must be manual) |
| **Missing dependencies** | No skill `.md` file · No production-slot calendar schema · No conflict detection between orders |
| **Notes** | `agent-production` cron is the closest existing implementation; plan should be draft-only until dispatcher confirms |

---

### `check-margin`

| Field | Value |
|---|---|
| **Purpose** | Calculate and flag margin on a deal or proposal |
| **Existing files to use** | `lib/calcServiceCost.ts` · `lib/b2bCalculator.ts` (`calcItem`, `calcTotals`) · `lib/commissionTiers.ts` · `app/api/cron/agent-revenue/route.ts` |
| **Existing files to avoid** | Any route that writes price overrides to CRM or Supabase without approval |
| **Missing dependencies** | No skill `.md` file · No margin threshold config per product type |
| **Notes** | `agent-revenue` cron already computes revenue KPIs; this skill focuses on per-deal margin check |

---

### `audit-manager-work`

| Field | Value |
|---|---|
| **Purpose** | Review a manager's daily/weekly activity against targets |
| **Existing files to use** | `lib/salesMonitor.ts` · `lib/amocrm.ts` · `app/api/amo/manager-stats/route.ts` · `lib/salesManagerPrompt.ts` · `app/api/cron/agent-analyst/route.ts` |
| **Existing files to avoid** | `app/api/admin/users/route.ts` (no automated role changes) |
| **Missing dependencies** | No skill `.md` file · No per-manager plan targets stored in DB · No structured audit output schema |
| **Notes** | `agent-analyst` cron is the closest implementation; skill should produce structured JSON, not only Telegram text |

---

## 5. Workflow-to-Code Map

### `morning-briefing`

| Field | Value |
|---|---|
| **Agents** | `chief-of-staff-agent` → delegates to `sales-director-agent` |
| **Skills needed** | `analyze-crm-day`, `audit-manager-work`, `check-margin` |
| **Data needed** | Yesterday's CRM activity, open stale deals, unpaid invoices |
| **Existing files** | `lib/salesMonitor.ts` · `lib/amocrm.ts` · `lib/telegram.ts` · `app/api/cron/sales-monitor/route.ts` |
| **Missing** | No morning-briefing cron (only evening at 18:00 exists) · No structured JSON output format · No workflow `.md` file |

---

### `evening-report`

| Field | Value |
|---|---|
| **Agents** | `sales-director-agent` |
| **Skills needed** | `analyze-crm-day`, `audit-manager-work` |
| **Data needed** | Today's activity metrics per manager |
| **Existing files** | `app/api/cron/sales-monitor/route.ts` — **already runs at 18:00** via Vercel cron · `lib/salesMonitor.ts` · `lib/telegram.ts` |
| **Missing** | Workflow `.md` file only — runtime effectively exists already |

---

### `new-lead-processing`

| Field | Value |
|---|---|
| **Agents** | `chief-of-staff-agent` → `proposal-engineer-agent` |
| **Skills needed** | `analyze-crm-day`, `create-commercial-proposal`, `check-catalog-item` |
| **Data needed** | New AmoCRM lead data, client requirements, product catalog |
| **Existing files** | `lib/amocrm.ts` · `app/api/ai/generate-kp/route.ts` · `app/api/amo/webhook/route.ts` |
| **Missing** | No approval gate before КП send · No lead-qualification scoring · No workflow `.md` file · No trigger from `amo/webhook` to proposal generation |

---

### `order-to-production`

| Field | Value |
|---|---|
| **Agents** | `production-dispatcher-agent` |
| **Skills needed** | `check-order-before-production`, `generate-production-plan` |
| **Data needed** | Payment status, drawing readiness, material availability, brigade schedule |
| **Existing files** | `lib/productionSummary.ts` · `app/api/orders/[id]/production-stages/route.ts` · `app/api/cron/agent-production/route.ts` · `lib/agentMemory.ts` |
| **Missing** | No drawing-readiness field in orders schema · No automated material check against stock · No workflow `.md` file |

---

## 6. Approval Matrix

| Action | Auto-allowed | Draft only | Requires Владислав | Forbidden |
|---|---|---|---|---|
| Read CRM data | ✅ | — | — | — |
| Read Supabase (catalog, orders, calcs) | ✅ | — | — | — |
| Draft commercial proposal | — | ✅ | — | — |
| Calculate price | ✅ | — | — | — |
| **Change price** | — | — | ✅ | — |
| **Send proposal to client** | — | — | ✅ | — |
| Create production task (draft) | — | ✅ | — | — |
| **Confirm production start** | — | — | ✅ | — |
| Delete catalog item | — | — | ✅ | — |
| Edit catalog item | — | ✅ | — | — |
| Run Supabase migration | — | — | — | ❌ |
| Push to production | — | — | — | ❌ |
| POST/PATCH to AmoCRM | — | — | — | ❌ |
| Access ENV secrets | — | — | — | ❌ |

---

## 7. Existing Strengths

What is already built and can be used immediately:

| Component | File | What it provides |
|---|---|---|
| Agent memory | `lib/agentMemory.ts` | `readMemory`, `writeMemory`, `writeLog`, `startRun`, `finishRun`, `failRun` |
| 4 live cron agents | `app/api/cron/agent-{analyst,production,revenue,ceo}/` | Anthropic + agentMemory + Telegram already wired |
| Health check framework | `lib/healthCheckRunner.ts` | Severity levels, check runner, fix log, 10+ existing checks |
| Permissions model | `lib/permissions.ts` · `lib/getRole.ts` | `UserPermissions` type, role-based guards |
| CRM read client | `lib/amocrm.ts` | READ-ONLY AmoCRM v4 — `getLeads`, `getEvents`, `getLeadNotes` |
| Sales monitor | `lib/salesMonitor.ts` | `collectAllMetrics()`, `buildReport()` — zone-based pipeline analysis |
| 5 calculators | `lib/mirrorCalculator.ts` · `lib/showerCalculator.ts` · `lib/loftCalculator.ts` · `lib/b2bCalculator.ts` · `lib/calcServiceCost.ts` | Pure functions, no side effects, safe to call |
| Quick calc API | `app/api/calc/quick/route.ts` · `lib/quickCalc.ts` | Single endpoint for all calc types |
| КП generation | `app/api/ai/generate-kp/route.ts` | Anthropic-powered proposal generation, already in production |
| Notification layer | `lib/telegram.ts` · `lib/notify.ts` | Send to admins, send to specific users |
| Catalog with safe delete | `app/admin/shower-hardware/CatalogTab.tsx` | Full CRUD with confirm guards |
| Prompt library | `lib/salesManagerPrompt.ts` · `lib/marketingManagerPrompt.ts` · `lib/contentGeneratorPrompt.ts` | System prompts ready for reuse |

---

## 8. Gaps

What is missing before agents can act safely:

| Gap | Impact | Priority |
|---|---|---|
| `ai/tools/tool-registry.ts` not connected to real functions | Agents have no callable tools | High |
| No skill `.md` files in `ai/skills/` | Skills exist only as names, no defined inputs/outputs | High |
| No agent action log (separate from `agentMemory`) | Cannot audit what an agent did in a session | High |
| No approval workflow UI | Владислав has no interface to approve/reject agent drafts | High |
| `ai/workflows/` empty | Workflows exist only in this doc | Medium |
| No health checks for agent actions | If an agent crashes mid-workflow, no alerting | Medium |
| No per-manager plan targets in DB | `audit-manager-work` can flag but not compare to plan | Medium |
| `ai/skills/`, `ai/memory/`, `ai/workflows/` have no files | Only directories exist | Medium |
| No drawing-readiness field in orders | `check-order-before-production` is incomplete | Low |
| RLS on `shower_catalog_items` not explicit | Any `authenticated` user can delete items | Low |

---

## 9. First Implementation Recommendation

**Start here:** `proposal-engineer-agent` + `create-commercial-proposal` skill

**Why this is the safest first step:**

1. `app/api/ai/generate-kp/route.ts` already exists and works in production
2. All 5 calculators are pure functions with no side effects
3. The output is a **draft** — nothing is sent automatically
4. No CRM writes required
5. Approval gate (Владислав reviews draft before send) is natural and easy to add

**Suggested implementation path:**

```
1. Create ai/skills/create-commercial-proposal.md
   — define inputs: product_type, dimensions, materials, client_name
   — define output: proposal_draft (text/JSON)
   — define approval gate: required before send

2. Create ai/agents/proposal-engineer-agent.md
   — allowed tools: read calculators, read catalog, call generate-kp API
   — forbidden: send to client without approval, modify prices

3. Wire tool-registry.ts to:
   — lib/quickCalc.ts → quickCalc()
   — app/api/ai/generate-kp/route.ts → generateKP()

4. Add AgentActionLog Supabase table (separate from agent_memory)
   — columns: agent_key, skill, action, input_summary, output_summary, approved_by, timestamp

5. Add minimal approval UI in /admin
   — list of pending agent drafts
   — approve / reject buttons
```

---

## 10. Recommended Next Implementation Prompts

Use these prompts in future sessions:

**Prompt 1 — Connect proposal-engineer to read-only calculators:**
```
Create ai/skills/create-commercial-proposal.md defining inputs, outputs,
and approval requirements. Then update ai/tools/tool-registry.ts to expose
lib/quickCalc.ts and app/api/ai/generate-kp/route.ts as callable tools.
Do not connect to CRM or enable send actions.
```

**Prompt 2 — Design AgentActionLog schema:**
```
Design a Supabase migration for an agent_action_log table. Columns should
include: id, agent_key, skill_name, action_type (read/draft/approve/execute),
input_summary (text), output_summary (text), approved_by (uuid FK to users),
status (pending/approved/rejected/executed), created_at.
Do not apply the migration. Show the SQL and explain the design.
```

**Prompt 3 — Add health check for catalog save/delete:**
```
Extend lib/healthCheckRunner.ts with two new checks:
- catalog_save: verify shower_catalog_items has all 10 extended columns
- catalog_rls: verify RLS policy exists for shower_catalog_items
Add them to INITIAL_CHECKS array. Do not change existing checks.
```
