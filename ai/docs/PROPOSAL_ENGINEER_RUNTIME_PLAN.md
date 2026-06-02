# Proposal Engineer — Runtime Plan

**Stage:** 1 — Foundation (read-only / draft-only)  
**Date:** 2026-06-02  
**Status:** Planning only. No runtime automation active.

---

## 1. Цель первого runtime-контура

Создать **минимальный безопасный контур**, в котором `proposal-engineer-agent` может подготовить черновик КП используя существующие калькуляторы и API — без каких-либо автоматических действий, записей в CRM или отправки клиентам.

Цель этапа 1: **доказать, что архитектура работает**, прежде чем подключать реальные side effects.

---

## 2. Почему read-only / draft-only

| Причина | Объяснение |
|---|---|
| Необратимость | Отправленный КП — коммерческое обязательство. Нельзя отозвать. |
| Цена | LLM не должна называть цену без расчёта через TypeScript-калькулятор. |
| Доверие | Менеджер должен видеть и понимать черновик перед отправкой. |
| Аудит | Нет `agent_action_log` таблицы — нет истории что агент делал. |
| Permissions | Нет approval UI — нет способа Владиславу approve/reject действия. |

Переход к `execute` mode — отдельное решение после полного аудита этапа 1.

---

## 3. Используемые tools в этом контуре

| Tool key | Режим | Существующий файл |
|---|---|---|
| `quickCalc` | read_only | `lib/quickCalc.ts` → `POST /api/calc/quick` |
| `generateKpDraft` | draft | `POST /api/ai/generate-kp` (Anthropic Claude) |
| `readPricingRules` | read_only | Supabase: `financial_settings` |
| `readProductRules` | read_only | Supabase product specs |
| `readProposalTemplates` | read_only | Supabase templates |
| `writeAgentLog` | execute | `lib/agentMemory.ts` → `writeLog()` |

Все объявлены в `ai/tools/tool-registry.ts`.  
**Ни один не вызывается автоматически.** Реализации подключаются в этапе 2.

---

## 4. Существующие файлы, которые будут подключены на этапе 2

```
lib/quickCalc.ts              → реализация quickCalc tool
lib/mirrorCalculator.ts       → внутри quickCalc для mirror
lib/showerCalculator.ts       → внутри quickCalc для shower
lib/loftCalculator.ts         → внутри quickCalc для loft
lib/b2bCalculator.ts          → внутри quickCalc для b2b
lib/calcServiceCost.ts        → расчёт монтажа
lib/agentMemory.ts            → writeLog, readMemory, writeMemory
app/api/ai/generate-kp/route.ts  → generateKpDraft tool
app/api/calc/quick/route.ts   → HTTP endpoint для quickCalc
```

---

## 5. Что сейчас НЕ реализовано (намеренно)

| Компонент | Причина | Когда |
|---|---|---|
| `lib/ai-tools/` — функции-обёртки | Нет approval UI для проверки до запуска | Этап 2 |
| `agent_action_log` таблица | Нет Supabase миграции | Этап 2 |
| Approval UI в `/admin` | Нет схемы для хранения черновиков | Этап 2 |
| Автосохранение черновика КП | Зависит от `agent_action_log` | Этап 2 |
| Webhook-триггер из AmoCRM | Нет обработчика → агент в `amo/webhook/route.ts` | Этап 3 |
| `check-catalog-item` skill | Не определён | Этап 2 |
| `check-margin` skill | Не определён | Этап 2 |

---

## 6. Approval — что требуется и от кого

```
Действие                          Кто подтверждает     Как сейчас
─────────────────────────────────────────────────────────────────
Расчёт через quickCalc            Автоматически ✅     Доступно
Генерация текста КП               Автоматически ✅     Доступно
Применение скидки                 Менеджер             Вручную
Отправка КП клиенту               Менеджер             Вручную
КП на нестандартный продукт       Владислав            Вручную
КП выше ценового порога           Владислав            Вручную
Сохранение черновика в БД         Не реализовано       Этап 2
```

---

## 7. Будущий поток выполнения

```
Менеджер вводит запрос (client_request + параметры)
        │
        ▼
[1] MISSING DATA CHECK
    Skill проверяет полноту входных данных.
    Если не хватает данных → вернуть missing_data + вопросы.
    Если данных достаточно → продолжить.
        │
        ▼
[2] QUICK CALC  (read_only)
    quickCalc(product_type, dimensions, options)
    → base_price, installation, delivery
    Цена из TypeScript-калькулятора, не из LLM.
        │
        ▼
[3] PRICING RULES CHECK  (read_only)
    readPricingRules() → margin_ok, allowed_discounts
    Проверить margin_ok. Если false → risk_flag 'critical'.
        │
        ▼
[4] GENERATE KP DRAFT  (draft)
    generateKpDraft(calculation_summary, templates)
    → proposal_draft (text)
    Использует /api/ai/generate-kp + Anthropic Claude.
    Результат — черновик, не финальный документ.
        │
        ▼
[5] LOG  (execute)
    writeAgentLog(agent, skill, action, summary, status='draft')
        │
        ▼
[6] RETURN SkillOutput
    missing_data / calculation_summary / proposal_draft /
    manager_message / approval_required: true / risk_flags
        │
        ▼
[7] HUMAN REVIEW  ← вся ответственность здесь
    Менеджер читает черновик.
    Уточняет детали если нужно.
    Запускает повторный расчёт если нужно.
        │
        ▼
[8] МЕНЕДЖЕР ОТПРАВЛЯЕТ КП  (вручную, не агент)
```

---

## 8. Риски этапа 1

| Риск | Вероятность | Митигация |
|---|---|---|
| LLM называет цену без расчёта | Средняя | `calc_source` обязательный в output; если пусто — reject |
| quickCalc возвращает 0 при неверных params | Средняя | risk_flag 'warning' если total_estimate = 0 |
| generateKpDraft недоступен (API timeout) | Низкая | Вернуть proposal_draft: null, сохранить calculation_summary |
| Менеджер использует черновик как финальный | Средняя | approval_required: true явно в output + manager_message |
| Агент предлагает нереальные сроки | Средняя | Explicit check: сроки запрещены в SKILL.md forbidden actions |
| Нет логирования если writeAgentLog упал | Низкая | Логировать локально, не блокировать основной flow |

---

## 9. Следующие шаги (этап 2)

### Приоритет 1 — Минимальный runtime

```bash
# Создать реализации tools
mkdir -p lib/ai-tools
# Файлы:
lib/ai-tools/quickCalcTool.ts        # обёртка над lib/quickCalc.ts
lib/ai-tools/generateKpDraftTool.ts  # обёртка над POST /api/ai/generate-kp
lib/ai-tools/pricingRulesTool.ts     # читает financial_settings из Supabase
```

### Приоритет 2 — Хранение черновиков

```sql
-- Новая миграция (не применять без подтверждения):
CREATE TABLE agent_action_log (
  id             bigserial primary key,
  agent_key      text not null,
  skill_name     text not null,
  action_type    text not null,  -- 'read' | 'draft' | 'approve' | 'execute'
  input_summary  text,
  output_summary text,
  status         text not null default 'pending', -- 'pending' | 'approved' | 'rejected'
  approved_by    uuid references auth.users(id),
  created_at     timestamptz not null default now()
);
```

### Приоритет 3 — Approval UI

```
app/admin/ai-proposals/page.tsx     # список черновиков КП
app/admin/ai-proposals/[id]/page.tsx # просмотр + approve/reject кнопки
```

### Приоритет 4 — Health checks

```typescript
// Добавить в lib/healthCheckRunner.ts:
check('agent_quickcalc', async () => {
  // Проверить что /api/calc/quick отвечает < 2s
})
check('agent_generate_kp', async () => {
  // Проверить что /api/ai/generate-kp доступен
})
```

---

## 10. Definition of Done для этапа 1

```
[x] ai/tools/tool-registry.ts — типы, декларации, ToolImplementationStatus обновлены
[x] ai/skills/create-commercial-proposal/SKILL.md — создан
[x] ai/agents/proposal-engineer-agent.md — создан
[x] ai/docs/PROPOSAL_ENGINEER_RUNTIME_PLAN.md — создан (этот файл)
[x] lib/ai-tools/quickCalcTool.ts — реализован, помечен implemented (6ff033a, 18d3d4f)
[x] lib/ai-tools/pricingRulesTool.ts — реализован, помечен implemented (a814b01)
[x] lib/ai-tools/generateKpDraftTool.ts — реализован, draft-only skeleton (26bb48f)
[x] lib/ai-tools/createCommercialProposalRuntime.ts — orchestrator создан, этап 1 завершён
[ ] agent_action_log миграция — (этап 2, требует подтверждения Владислава)
[ ] Approval UI в /admin/ai-proposals — (этап 2, зависит от миграции)
[ ] model call binding в generateKpDraftTool — (этап 2, зависит от Approval UI)
[ ] Health checks для агент-tools — (этап 2)
```

### Статус этапа 1 (актуально)

Минимальный read-only/draft runtime-контур завершён:

```
client input
    │
    ▼
createCommercialProposalRuntime (local orchestrator)
    │
    ├─ [1] runQuickCalcTool      → calculation (читает Supabase, no writes)
    ├─ [2] runPricingRulesTool   → pricing_rules (читает Supabase, no writes)
    └─ [3] runGenerateKpDraftTool → draft (input payload only, no Supabase)
    │
    ▼
{ ok, calculation, pricing_rules, draft, approval_required: true, can_send_to_client: false }
    │
    ▼
[HUMAN REVIEW] — менеджер проверяет и отправляет вручную
```

Следующие шаги этапа 2:
1. Supabase-миграция `agent_action_log` — для логирования действий агента
2. Approval UI в `/admin/ai-proposals` — для review черновиков менеджером
3. После Approval UI: подключить model call в `generateKpDraftTool` через внутренний service layer
