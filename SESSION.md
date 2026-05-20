## Текущая задача
Нет активной задачи

## Что сделано (сессия 20 мая)

### ERP инфраструктура — закупки/склад/логистика
- `app/admin/stock-control` — дашборд критических остатков (фурнитура + материалы), ручное обновление
- `app/admin/procurement` — Канбан закупок, 8 статусов, карточки счетов
- `app/admin/procurement-routes` — маршруты к поставщикам, редактор точек, печать
- `app/api/admin/purchase-orders` — CRUD API
- `app/api/admin/procurement-routes` — CRUD API
- `lib/getRole.ts` — новые пути в ROLE_ALLOWED.buyer
- `app/admin/guide` — расширен регламент (14 разделов, полный ERP)

### Поставщики — полная переработка
- `app/admin/suppliers` — статусы, типы, WhatsApp/Telegram/адрес/город/режим/срок/НДС/приоритет, модалки, фильтры
- `app/api/admin/suppliers` — buyer разрешён на POST/PATCH, DELETE только admin
- `app/api/admin/suppliers/[id]` — аналогично

### Прочие доработки
- `app/admin/archive` — страница архивных B2B расчётов с восстановлением
- `components/Sidebar.tsx` — архив в ADMIN_B2B и MANAGER_B2B
- `app/calculator/b2b` — cap на скидку (max_discount_percent из users)
- `app/b2b-quotes` — фильтр по manager_id через b2b_clients (OR created_by)

## SQL миграции выполнены
- is_critical, min_stock, recommended_stock на shower_catalog_items ✅
- min_stock_qty, recommended_stock, is_critical на materials ✅
- CREATE TABLE purchase_orders ✅
- CREATE TABLE procurement_routes + stops ✅
- suppliers: type, whatsapp, telegram, address, city, work_hours, status, priority, lead_time_days, has_vat, updated_at ✅

## Следующие возможные задачи
- Загрузка прайсов к поставщикам (PDF/Excel attachment)
- История изменений поставщика
- Подтверждение доставки клиентом (подпись в системе)
- Учёт затрат на логистику по маршрутам
