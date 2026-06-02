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

| Файл | Tool key | Режим | Читает | Пишет | Статус | Назначение |
|---|---|---|---|---|---|---|
| `quickCalcTool.ts` | `quickCalc` | read_only | materials, services, financial_settings | — | ✅ Реализован | Быстрая оценка стоимости (mirror / shower / loft) |
| `pricingRulesTool.ts` | `readPricingRules` | read_only | financial_settings | — | ✅ Реализован | Структурированные правила маржи, скидок и расходов для proposal/check-margin |

## Планируемые tools (этап 2)

| Файл | Tool key | Описание |
|---|---|---|
| `generateKpDraftTool.ts` | `generateKpDraft` | Черновик КП через `/api/ai/generate-kp` + Anthropic |
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
