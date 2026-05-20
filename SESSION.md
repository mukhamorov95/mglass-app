## Текущая задача
Нет активной задачи

## Что сделано (сессия 19 мая)

### Фацет — единый справочник
- `lib/mirrorCalculator.ts` — добавлены поля фацета в MirrorInputs, расчёт в costLines
- `app/calculator/mirror/page.tsx` — загрузка facet_prices, UI выбора типа фацета
- `components/Sidebar.tsx` — фацет перенесён из B2B → общий раздел Справочники
- `lib/quickCalc.ts` — добавлены обязательные поля hasFacet/facetTypeMm/facetCostPerM/facetSalePerM

### Изоляция расчётов менеджера
- `app/calculations/page.tsx` — передаётся userId в клиентский компонент
- `app/calculations/CalculationsClient.tsx` — фильтр .eq('created_by', userId) для не-админов

### B2B клиенты — изоляция менеджеров
- `lib/getRole.ts` — /b2b-crm убран из ROLE_ALLOWED для manager (редирект на /access-denied)
- `components/Sidebar.tsx` — /b2b-crm скрыт из меню менеджера
- `lib/types.ts` — добавлены manager_id, manager_code в тип B2BClient
- `app/calculator/b2b/page.tsx`:
  - менеджер видит только своих клиентов (фильтр по manager_id)
  - кнопка "+ Новый клиент" + модалка с проверкой дублей
  - новый клиент автоматически закрепляется за менеджером
- `app/b2b-crm/page.tsx`:
  - кнопка "Менеджер" в панели быстрых действий
  - inline назначение ответственного менеджера
  - сохранение истории смены в b2b_client_manager_history

## SQL миграции выполнены
- facet_prices (CREATE TABLE + INSERT + DISABLE RLS) ✅
- b2b_clients: manager_id, manager_code ✅
- b2b_client_manager_history ✅

## Следующие возможные задачи
- Страница архива: /admin/archive (b2b_orders WHERE archived_at IS NOT NULL)
- Discount cap: проверка max_discount_percent в B2B калькуляторе
- Фильтр клиентов в b2b-quotes по manager_id для менеджеров
