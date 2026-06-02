# agent_action_log — Таблица действий AI-агентов

**Migration:** `supabase/migrations/20260603_agent_action_log.sql`  
**TypeScript types:** `lib/ai-tools/agentActionLogTypes.ts`  
**Status:** Schema designed. Migration NOT applied yet — apply manually after review.

---

## Назначение

`agent_action_log` — постоянный аудит-лог всех действий AI-агентов:

- Каждый запуск `createCommercialProposalRuntime` создаёт одну запись
- Черновики КП хранятся в поле `draft_payload` (jsonb)
- История approval: кто, когда, одобрил или отклонил
- Диагностика: предупреждения, ошибки, safety-флаги каждого шага

**Принцип хранения:** записи никогда не удаляются — только архивируются (`status = 'archived'`).

---

## Какие actions логируются

| `action_type` | Когда создаётся |
|---|---|
| `proposal_draft_created` | `createCommercialProposalRuntime` завершился успешно |
| `proposal_draft_updated` | Черновик перегенерирован для существующей записи |
| `proposal_approved` | Менеджер одобрил черновик в Approval UI |
| `proposal_rejected` | Менеджер отклонил черновик |
| `calculation_run` | Отдельный вызов `runQuickCalcTool` |
| `pricing_rules_read` | Отдельный вызов `runPricingRulesTool` |
| `kp_draft_generated` | Отдельный вызов `runGenerateKpDraftTool` |
| `runtime_completed` | Полный оркестратор — все шаги пройдены |
| `error` | Ошибка на любом шаге runtime |

---

## Как createCommercialProposalRuntime будет сохраняться (этап 2)

Сейчас `createCommercialProposalRuntime` не пишет в базу — работает как in-memory функция.

После применения миграции и реализации `writeAgentActionLog()`:

```typescript
// Будущий writeAgentActionLog (не реализован сейчас)
const logRecord: AgentActionLogInsert = {
  agent_key:    'proposal-engineer',
  skill_key:    'create-commercial-proposal',
  workflow_key: 'create-commercial-proposal-runtime',
  action_type:  result.ok ? 'proposal_draft_created' : 'error',
  status:       result.ok ? 'pending_approval' : 'failed',

  // Business linkage
  proposal_title: result.draft?.proposal_title ?? null,
  calculation_id: existingCalcId ?? null,
  client_name:    input.client_name ?? null,

  // Payloads
  input_snapshot:  { ...input, manager_notes: input.manager_notes },
  output_snapshot: { ok: result.ok, steps: result.steps, warnings: result.warnings },
  draft_payload:   result.draft as unknown as Record<string, unknown> ?? null,
  safety_snapshot: result.safety,
  error_snapshot:  result.errors.length > 0 ? result.errors : null,

  // Safety flags (mirrors runtime output)
  approval_required:  result.approval_required,   // always true
  can_send_to_client: result.can_send_to_client,  // always false
  can_write_crm:      result.can_write_crm,       // always false
  can_create_order:   result.can_create_order,    // always false

  // Diagnostics
  warnings:             result.warnings,
  errors:               result.errors,
  model_call_executed:  result.safety.model_call_executed,  // always false at stage 1
}
```

---

## Поля, отвечающие за approval

| Поле | Тип | Назначение |
|---|---|---|
| `approval_required` | boolean DEFAULT true | Всегда true для draft-mode actions |
| `status` | text | `draft → pending_approval → approved / rejected` |
| `can_send_to_client` | boolean DEFAULT false | Может ли черновик быть отправлен клиенту |
| `can_write_crm` | boolean DEFAULT false | Может ли action писать в CRM |
| `can_create_order` | boolean DEFAULT false | Может ли action создать производственный заказ |
| `approved_at` | timestamptz | Когда менеджер одобрил (обязателен при `status = 'approved'`) |
| `rejected_at` | timestamptz | Когда менеджер отклонил (обязателен при `status = 'rejected'`) |
| `rejection_reason` | text | Причина отказа от менеджера |
| `approved_by` | text | Идентификатор менеджера, утвердившего КП |
| `approval_snapshot` | jsonb | Полный payload решения: `{ approved_by, timestamp, notes, action }` |

### Lifecycle статуса

```
draft
  └→ pending_approval   (runtime записал, отправил на ревью)
       ├→ approved       (менеджер одобрил — approved_at обязателен)
       ├→ rejected        (менеджер отклонил — rejected_at обязателен)
       └→ failed          (технический сбой до принятия решения)
                          ↓
                        archived  (ручное архивирование из UI)
```

---

## Safety guarantees

Таблица хранит safety-флаги каждого действия:

```
approval_required:    true    — всегда для proposal-engineer actions
can_send_to_client:   false   — КП не отправляется клиенту автоматически
can_write_crm:        false   — CRM не обновляется автоматически
can_create_order:     false   — производственный заказ не создаётся
model_call_executed:  false   — Anthropic не вызывается на текущем этапе
```

Эти значения сохраняются в `safety_snapshot` (jsonb) и продублированы в отдельных колонках для query efficiency.

---

## RLS / Policies

```
RLS:          ENABLED
SELECT:       TO authenticated — менеджеры видят все записи (Approval UI)
INSERT:       TO authenticated — в практике используется SUPABASE_SERVICE_ROLE_KEY (bypasses RLS)
UPDATE:       TO authenticated — менеджер переключает статус через Approval UI
DELETE:       нет policy       — удаление заблокировано на уровне клиента
```

**Примечание:** `SUPABASE_SERVICE_ROLE_KEY` используемый в `lib/ai-tools/` полностью обходит RLS. Политики защищают только клиентский JWT-доступ (браузер, Approval UI).

**TODO (этап 2):** Ограничить UPDATE так, чтобы только пользователи с ролью `admin` могли менять `status = 'approved'`. Добавить CHECK против `auth.uid()` или перенести approval в API route с проверкой роли через `getRole()`.

---

## Что сейчас НЕ реализовано

| Компонент | Статус | Когда |
|---|---|---|
| `writeAgentActionLog()` функция | Не создана | Этап 2 |
| Запись из `createCommercialProposalRuntime` | Не подключена | После миграции |
| Approval UI (`/admin/ai-proposals`) | Не создан | После миграции |
| Model call binding в generateKpDraftTool | Не подключён | После Approval UI |
| Ограничение UPDATE только для admin role | TODO | Этап 2, после getRole() integration |
| Retention policy / archival job | Не определена | Этап 3 |

---

## Manual Migration Checklist

Перед применением:
- [ ] Убедиться, что таблица `agent_action_log` НЕ существует: `SELECT * FROM agent_action_log LIMIT 1` — должна вернуть ошибку
- [ ] Просмотреть migration файл целиком: `supabase/migrations/20260603_agent_action_log.sql`
- [ ] Нет production данных, которые затронет migration
- [ ] Получить подтверждение от Владислава

Применение:
1. Открыть Supabase Dashboard → SQL Editor
2. Вставить содержимое `supabase/migrations/20260603_agent_action_log.sql`
3. Нажать **Run** (или `Ctrl+Enter`)
4. Проверить: `SELECT COUNT(*) FROM agent_action_log;` → должно вернуть 0
5. Проверить индексы: `SELECT indexname FROM pg_indexes WHERE tablename = 'agent_action_log';`
6. Проверить RLS: `SELECT * FROM pg_policies WHERE tablename = 'agent_action_log';`

После применения:
- [ ] Обновить этот документ: убрать "NOT applied yet"
- [ ] Создать `writeAgentActionLog()` в `lib/ai-tools/`
- [ ] Подключить к `createCommercialProposalRuntime`

---

## Future Integration Steps

### Этап 2A — writeAgentActionLog()

```typescript
// lib/ai-tools/writeAgentActionLog.ts (создать)
// Принимает AgentActionLogInsert, пишет в agent_action_log через SERVICE_ROLE_KEY.
// Возвращает { ok, id, error? } — никогда не бросает исключение.
```

### Этап 2B — Approval UI

```
app/admin/ai-proposals/page.tsx
  — список всех proposal drafts (status = pending_approval)
  — фильтрация по agent, skill, дате, клиенту

app/admin/ai-proposals/[id]/page.tsx
  — просмотр полного черновика
  — кнопки: Approve / Reject
  — поле rejection_reason при отклонении
  — вызов UPDATE agent_action_log SET status, approved_at, approval_snapshot
```

### Этап 2C — Model call binding

После того как Approval UI существует:
1. Добавить `writeAgentActionLog()` в `createCommercialProposalRuntime`
2. Подключить Anthropic SDK в `generateKpDraftTool` через внутренний service layer (НЕ HTTP fetch к API route)
3. Обновить `model_call_executed: true` и `model_name` при реальном вызове

---

## Связанные файлы

| Файл | Назначение |
|---|---|
| `supabase/migrations/20260603_agent_action_log.sql` | Schema + indexes + RLS |
| `lib/ai-tools/agentActionLogTypes.ts` | TypeScript types (type-only, no DB) |
| `lib/ai-tools/createCommercialProposalRuntime.ts` | Orchestrator (future writer) |
| `lib/ai-tools/generateKpDraftTool.ts` | Produces draft_payload content |
| `ai/docs/PROPOSAL_ENGINEER_RUNTIME_PLAN.md` | Overall stage plan |
| `ai/tools/tool-registry.ts` | writeAgentLog tool declaration |
