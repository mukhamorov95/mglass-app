# lib/ai-tools — AI Agent Runtime Tools

Безопасные runtime-обёртки для AI-агентов M-Glass.

## Назначение

Каждый файл в этой папке — адаптер между декларативным реестром `ai/tools/tool-registry.ts` и реальной логикой проекта. Tools предоставляют структурированные, типизированные интерфейсы с предсказуемым output, который агент может безопасно использовать.

## Правила для всех tools

```
✅ Читать данные из Supabase (materials, settings, catalog) — разрешено
✅ Использовать существующие TypeScript-калькуляторы — разрешено
✅ Возвращать структурированный typed output — обязательно
✅ Логировать ошибки в console.error — разрешено

❌ Писать в Supabase напрямую — запрещено
❌ Отправлять данные в AmoCRM — запрещено (CRM read-only)
❌ Отправлять сообщения клиентам — запрещено
❌ Вызывать Anthropic/OpenAI внутри tool — запрещено
❌ Бросать сырые ошибки наружу — запрещено
❌ Раскрывать stack trace / Supabase error в user-facing сообщениях — запрещено
```

Все write/execute действия требуют прохождения approval-policy (см. `ai/policies/approval-policy.md`).

## Текущие tools

| Файл | Tool key | Режим | Читает | Пишет | Approval | Статус | Назначение |
|---|---|---|---|---|---|---|---|
| `quickCalcTool.ts` | `quickCalc` | read_only | materials, services, financial_settings | — | не требуется | ✅ Реализован | Быстрая оценка стоимости (mirror / shower / loft) |
| `pricingRulesTool.ts` | `readPricingRules` | read_only | financial_settings | — | не требуется | ✅ Реализован | Структурированные правила маржи, скидок и расходов |
| `generateKpDraftTool.ts` | `generateKpDraft` | draft | input payload only | — | **обязательно** | ✅ Реализован | Черновик КП для проверки менеджером (skeleton, без model call) |
| `b2bQuickQuoteTool.ts` | `b2bQuickQuote` | read_only | partner_types + quickCalcTool | — | **обязательно** | ✅ Реализован | B2B быстрый расчёт (mirror/shower/loft) + партнёрская скидка, черновик ответа |

## Orchestrators (runtime combinators)

| Файл | Runtime key | Режим | Вызывает | Approval | Статус | Назначение |
|---|---|---|---|---|---|---|
| `createCommercialProposalRuntime.ts` | `create-commercial-proposal` | draft | quickCalcTool → pricingRulesTool → generateKpDraftTool | **обязательно** | ✅ Реализован | Полный pipeline черновика КП — единый вход/выход для proposal-engineer-agent |
| `createB2BQuickQuoteRuntime.ts` | `b2b-quick-quote-draft` | draft | b2bQuickQuoteTool | **обязательно** | ✅ Реализован | B2B Quick Quote — нормализованный draft для b2b-sales-agent; agent_action_log на следующем этапе |

## Safety profile createB2BQuickQuoteRuntime

```
no_db_write:            true   // runtime не пишет сам
no_crm_write:           true
no_client_send:         true   // draft_payload.client_message_draft не отправляется автоматически
no_order_create:        true
no_agent_action_log:    true   // на текущем этапе; следующий этап — API route сохраняет результат
reads_supabase:         true   // через b2bQuickQuoteTool (partner_types + quickCalcTool)
model_call_executed:    false
approval_required:      true   // ВСЕГДА
can_send_to_client:     false  // ВСЕГДА
```

output_snapshot и draft_payload готовы к сохранению в agent_action_log через API route (Commit 4).

## Safety profile b2bQuickQuoteTool

```
no_db_write:     true
no_crm_write:    true
no_client_send:  true    // ВСЕГДА — client_message_draft не отправляется автоматически
no_order_create: true
reads_supabase:  true    // partner_types — SELECT only; quickCalcTool читает materials/services/financial_settings
model_call_executed: false
approval_required:   true  // ВСЕГДА — черновик требует проверки менеджером
```

Phase 1: mirror/shower/loft через quickCalcTool. Партнёрская скидка применяется post-calculation.  
Phase 2 (planned): glass/cutting через lib/b2bCalculator.ts.

## Планируемые tools (этап 2)

| Файл | Tool key | Описание |
|---|---|---|
| `productRulesTool.ts` | `readProductRules` | Чтение ограничений по размерам и материалам |
| `proposalTemplatesTool.ts` | `readProposalTemplates` | Шаблоны оформления КП |

## Связь с tool-registry

Каждый tool имплементирует соответствующую запись в `ai/tools/tool-registry.ts`.  
Ключи совпадают: `TOOL_REGISTRY.find(t => t.key === 'quickCalc')`.

## Safety profile quickCalcTool

```
no_db_write:    true
no_crm_write:   true
no_client_send: true
reads_supabase: true   // materials, services, financial_settings — только чтение
```

## Safety profile pricingRulesTool

```
no_db_write:         true
no_crm_write:        true
no_external_request: true
no_client_send:      true
can_change_price:    false
reads_supabase:      true   // financial_settings — только чтение
```

## Safety profile generateKpDraftTool

```
no_db_write:          true
no_crm_write:         true
no_client_send:       true    // ВСЕГДА — черновик никогда не отправляется клиенту
no_order_create:      true
reads_supabase:       false   // input payload only, no DB calls
model_call_executed:  false   // Anthropic/OpenAI не вызывается на текущем этапе
approval_required:    true    // ВСЕГДА — обязательна проверка менеджером
```

Future binding: model call будет подключён через внутренний service layer
(не HTTP fetch) после реализации approval flow (agent_action_log + Approval UI).

## Safety profile createCommercialProposalRuntime

```
no_db_write:               true   // orchestrator не пишет сам
no_crm_write:              true
no_client_send:            true
no_order_create:           true
no_external_http:          true
reads_supabase_via_tools:  true   // quickCalcTool + pricingRulesTool читают Supabase
model_call_executed:       false
approval_required:         true   // ВСЕГДА
can_send_to_client:        false  // ВСЕГДА
```

Orchestrator — не tool, а pipeline-координатор. Не объявляется в tool-registry.
Вызывается proposal-engineer-agent напрямую как entry point для create-commercial-proposal skill.
