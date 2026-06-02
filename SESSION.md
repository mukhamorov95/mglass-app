## Текущая задача
AI Proposal Approval Flow — production MVP завершён и протестирован. Следующий этап — UI-форма создания черновика КП.

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

### Production QA — ЗАКРЫТО (3 июня 2026)

| id | Результат | Статус |
|----|-----------|--------|
| 1 | mirror payload — quickCalc вернул null (нет материала category='зеркало' в Supabase), корректно сохранён как `failed` | ✅ ожидаемо |
| 2 | shower draft — создан, одобрен. `approved_at` заполнен, `approved_by = admin@mglass.ru` | ✅ |
| 3 | shower draft — создан, отклонён. `rejected_at` заполнен, `rejection_reason` сохранён | ✅ |

Подтверждено на production:
- `/admin/ai-proposals` открывается, safety banner отображается
- Safety flags: `approval_required=true`, `can_send_to_client=false`, `can_write_crm=false`, `can_create_order=false`, `model_call_executed=false`
- Клиенту ничего не отправляется
- AmoCRM не трогается
- Заказ не создаётся
- Anthropic/OpenAI не вызываются
- RLS: authenticated — только SELECT; writes — только через server API + service role

## Следующий шаг

Сделать UI-форму **"Создать AI-КП"** на `/admin/ai-proposals` (кнопка/панель над таблицей):

**Поля формы:**
- `client_request` (textarea, обязательное)
- `product_type` (select: mirror / shower / loft)
- `width`, `height` (number, мм)
- `quantity` (number, default 1)
- `installation_required` (checkbox)
- `delivery_required` (checkbox)
- `client_name` (text, необязательное)
- `manager_notes` (textarea, необязательное)

**Поведение:**
- Кнопка "Создать черновик" → POST `/api/ai/proposals/draft`
- После успешного создания → redirect на `/admin/ai-proposals/{id}`
- При ошибке — показать inline message
- Без отправки клиенту, без CRM, без create order

**Файлы для изменения:**
- `app/admin/ai-proposals/page.tsx` — добавить форму (раскрывающаяся панель или отдельный блок)

## Контекст

- Весь код закоммичен и задеплоен на production (Vercel)
- agent_action_log миграции применены в Supabase
- RLS fix применён вручную в SQL Editor
- Production тест пройден: 3 записи в agent_action_log (id 1, 2, 3)
- `SESSION.md` — единственный незакоммиченный файл

## Текущие ограничения (known limitations)

- Создание черновика пока через API/console — нет удобной UI-формы (следующий шаг)
- mirror payload падает без активного материала `category='зеркало'` в таблице `materials`
- Нет pagination в списке `/admin/ai-proposals`
- Нет rate limiting на POST `/api/ai/proposals/draft`
- Нет direct manager role access — UI доступен по текущей admin-модели
- Anthropic binding намеренно выключен (`allowModelCall: false`)

## Открытые вопросы

- RLS на `shower_catalog_items` не настроена явно — ограничение только на уровне маршрута `/admin`
- `ai/skills/`, `ai/workflows/`, `ai/memory/` — директории не созданы, запланированы для будущих этапов
- mirror category='зеркало' материал нужно добавить в Supabase для работы mirror-payload
