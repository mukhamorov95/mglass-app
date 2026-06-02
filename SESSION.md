## Текущая задача
Задача по справочнику душевой фурнитуры завершена. Следующий приоритет — AI-архитектура.

## Что сделано (сессия 29 мая — 2 июня)

### Справочник душевой фурнитуры — ЗАКРЫТО
- `supabase/migrations/20260529_shower_catalog_items_extend.sql` — миграция добавила 10 колонок в `shower_catalog_items`: `hinge_type`, `track_type`, `item_role`, `depends_on_item_id`, `sort_order`, `min_qty`, `max_qty`, `lead_days`, `stock_qty`, `subcategory`
- Миграция применена в Supabase Dashboard, проверена через `information_schema` — 10 строк
- `app/admin/shower-hardware/CatalogTab.tsx` — улучшена обработка ошибок сохранения: `priceError` / `formError` разделены, понятные сообщения пользователю, технические детали только в `console.error`
- `app/admin/shower-hardware/CatalogTab.tsx` — добавлена безопасная кнопка удаления: `deleteItem`, `window.confirm`, `deletingId` (блокировка кнопки), `deleteError` (красная плашка), каскадное удаление цен через FK
- Vercel deployment прошёл, production обновлён
- Ручная проверка на production успешна: сохранение, редактирование, удаление, перезагрузка страницы

### AI operational layer — ЗАКРЫТО
- `ai/` — создана структура: `agents/`, `policies/`, `tools/`, `README.md`
- `ai/agents/chief-of-staff-agent.md`, `ai/agents/sales-director-agent.md`
- `ai/policies/ai-safety-policy.md`, `ai/policies/approval-policy.md`, `ai/policies/permissions-policy.md`
- `ai/tools/README.md`, `ai/tools/tool-registry.ts`

## Последние коммиты
- `7f2915d` feat(admin): add safe delete for shower hardware catalog items
- `adfe6c7` feat(admin): extend shower catalog items and improve save errors
- `f0663e1` feat: add AI operational layer structure

## Следующий шаг
Перейти к следующему этапу AI-архитектуры:
1. Связать `ai/agents` и `ai/skills` с реальными модулями проекта
2. Составить карту `skill → существующие файлы` (например: `create-commercial-proposal` → `app/calculator/`, `app/calculations/`)
3. Начать с `proposal-engineer-agent` и `create-commercial-proposal` skill
4. Не подключать автоматические действия без прохождения `approval-policy`

## Контекст
- Код по задаче закоммичен и запушен в `main`
- Production обновлён, ручной тест пройден
- `SESSION.md` — единственный незакоммиченный файл на момент закрытия задачи
- Калькулятор душевых (`app/calculator/shower/page.tsx`) использует новые колонки — работает корректно

## Открытые вопросы
- RLS-политика на `shower_catalog_items` не настроена явно — любой `authenticated` может удалять. Ограничение сейчас на уровне маршрута `/admin`. Стоит добавить отдельной задачей.
- `ai/skills/`, `ai/workflows/`, `ai/memory/` — директории не созданы, запланированы для следующего этапа
