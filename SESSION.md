## Текущая задача
AI Proposal MVP с UI-формой создания черновика завершён и протестирован на production.

## Что сделано (сессия 29 мая — 3 июня)

### Справочник душевой фурнитуры — ЗАКРЫТО
- `supabase/migrations/20260529_shower_catalog_items_extend.sql` — миграция добавила 10 колонок в `shower_catalog_items`
- `app/admin/shower-hardware/CatalogTab.tsx` — улучшена обработка ошибок, добавлена безопасная кнопка удаления
- Production обновлён, ручная проверка пройдена

### AI operational layer — ЗАКРЫТО
- `ai/` — структура: `agents/`, `policies/`, `tools/`, `README.md`
- `ai/agents/chief-of-staff-agent.md`, `ai/agents/sales-director-agent.md`
- `ai/policies/ai-safety-policy.md`, `ai/policies/approval-policy.md`, `ai/policies/permissions-policy.md`
- `ai/tools/README.md`, `ai/tools/tool-registry.ts`

### AI skill/code map — ЗАКРЫТО
- Составлена карта `skill → существующие файлы`
- `create-commercial-proposal` → `app/calculator/`, `lib/quickCalc.ts`, `lib/mirrorCalculator.ts`, `lib/showerCalculator.ts`, `lib/loftCalculator.ts`

### proposal-engineer foundation — ЗАКРЫТО
- `lib/ai-tools/agentActionLogTypes.ts` — все типы: `AgentActionLogInsert`, `AgentActionLogRecord`, `AgentSafetySnapshot`, `AgentApprovalSnapshot`

### quickCalcTool — ЗАКРЫТО
- `lib/ai-tools/quickCalcTool.ts` — read-only враппер над `lib/quickCalc.ts`
- Поддерживает: `mirror` | `loft` | `shower`
- Безопасность: нет DB write, нет CRM write, нет отправки клиенту

### pricingRulesTool — ЗАКРЫТО
- `lib/ai-tools/pricingRulesTool.ts` — read-only, читает `financial_settings` + `materials` + `services`

### generateKpDraftTool — ЗАКРЫТО
- `lib/ai-tools/generateKpDraftTool.ts` — детерминированный генератор черновика КП
- Anthropic binding намеренно выключен (`allowModelCall: false`)

### createCommercialProposalRuntime — ЗАКРЫТО
- `lib/ai-tools/createCommercialProposalRuntime.ts` — оркестратор: `quickCalcTool → pricingRulesTool → generateKpDraftTool`
- Все safety flags hardcoded: `approval_required: true`, `can_send_to_client: false`, `can_write_crm: false`, `can_create_order: false`, `model_call_executed: false`

### agent_action_log schema — ЗАКРЫТО
- `supabase/migrations/20260603_agent_action_log.sql` — таблица, 9 индексов, CHECK constraints
- `supabase/migrations/20260603_agent_action_log_rls_fix.sql` — убраны INSERT/UPDATE для authenticated, оставлен только SELECT
- Применено в Supabase Dashboard

### Proposal Draft API routes — ЗАКРЫТО (коммит `66d7b1f`)
- `app/api/ai/proposals/draft/route.ts` — POST, сохранение через service role
- `app/api/ai/proposals/route.ts` — GET list с фильтром по статусу
- `app/api/ai/proposals/[id]/route.ts` — GET single
- `app/api/ai/proposals/[id]/approve/route.ts` — POST approve
- `app/api/ai/proposals/[id]/reject/route.ts` — POST reject
- `lib/supabase-service.ts` — централизованный service role client

### Approval UI — ЗАКРЫТО (коммит `4c3f8c7`)
- `app/admin/ai-proposals/page.tsx` — список с фильтрами, badges, warnings/errors count
- `app/admin/ai-proposals/[id]/page.tsx` — detail: safety banner, safety flags, draft content, approve/reject flow, copy buttons

### UI-форма "Создать AI-КП" — ЗАКРЫТО (коммит `e78daf2`)
- `app/admin/ai-proposals/page.tsx` — добавлена раскрывающаяся форма создания черновика
- Поля: `client_request`, `product_type`, `width`, `height`, `quantity`, `client_name`, `installation_required`, `delivery_required`, `manager_notes`
- Submit → POST `/api/ai/proposals/draft` → redirect на detail page
- Failed with id → inline amber-блок со ссылкой на запись
- Hard errors → user-friendly сообщение, `console.error` для деталей
- Форма не обращается к Supabase напрямую; service role не попадает в client component
- Safety info block внутри формы: явно указано, что КП не отправляется клиенту

### Production QA — ЗАКРЫТО (3 июня 2026)

| id | Источник | Результат | Статус |
|----|----------|-----------|--------|
| 1 | API/console | mirror payload — quickCalc вернул null, корректно сохранён как `failed` | ✅ ожидаемо |
| 2 | API/console | shower draft — создан, одобрен | ✅ |
| 3 | API/console | shower draft — создан, отклонён | ✅ |
| 4 | UI-форма | shower 1200×2000 — создан через форму, detail page открылся, approved | ✅ |

Подтверждено на production (id 4, UI-форма):
- `/admin/ai-proposals` открывается, кнопка «+ Создать AI-КП» отображается
- Форма раскрывается, safety block внутри виден
- Черновик создан через UI, redirect на `/admin/ai-proposals/4` сработал
- Safety flags: `approval_required=true`, `can_send_to_client=false`, `can_write_crm=false`, `can_create_order=false`, `model_call_executed=false`
- Клиенту ничего не отправилось
- AmoCRM не трогалась
- Заказ не создавался
- Anthropic/OpenAI не вызывались
- RLS: authenticated — только SELECT; writes — только через server API + service role

## Следующий шаг

**Вариант A (рекомендуемый) — Mirror data readiness:**
1. Проверить таблицу `materials` в Supabase: `SELECT name, category, active, cost_price FROM materials WHERE category = 'зеркало'`
2. Добавить активный материал если отсутствует: `INSERT INTO materials (name, category, cost_price, active) VALUES ('Зеркало серебро 4мм', 'зеркало', 1200, true)`
3. Проверить `services` для зеркал
4. Протестировать mirror AI-КП через UI-форму

**Вариант B — Улучшение качества skeleton-текста:**
Доработать `lib/ai-tools/generateKpDraftTool.ts` — поля `installation_required` / `delivery_required` должны выводиться как человекочитаемые формулировки вместо boolean-значений.

## Контекст

- Весь код закоммичен и задеплоен на production (Vercel)
- agent_action_log миграции применены в Supabase
- RLS fix применён вручную в SQL Editor
- Production тест пройден: 4 записи в agent_action_log (id 1–4)
- `SESSION.md` — единственный незакоммиченный файл

## Текущие ограничения (known limitations)

- mirror payload падает без активного материала `category='зеркало'` в таблице `materials`
- Нет редактирования черновика перед approve
- Нет pagination в списке `/admin/ai-proposals`
- Нет rate limiting на POST `/api/ai/proposals/draft`
- Нет Anthropic binding — генерация детерминированная (`allowModelCall: false`)
- Нет CRM-read integration — клиент заполняется вручную
- Skeleton-текст черновика может требовать ручной правки (boolean-поля не форматированы как текст)

## Открытые вопросы

- RLS на `shower_catalog_items` не настроена явно — ограничение только на уровне маршрута `/admin`
- `ai/skills/`, `ai/workflows/`, `ai/memory/` — директории не созданы, запланированы для будущих этапов
- mirror category=`зеркало` материал нужно добавить в Supabase для работы mirror-payload
