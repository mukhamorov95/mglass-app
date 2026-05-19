## Текущая задача
Создание менеджеров + soft delete + activity log viewer

## SQL МИГРАЦИИ (ВСЕ ВЫПОЛНИТЬ В SUPABASE!)

```sql
-- 1. Права доступа
ALTER TABLE users ADD COLUMN IF NOT EXISTS max_discount_percent integer NOT NULL DEFAULT 5;
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_delete boolean NOT NULL DEFAULT false;
UPDATE users SET max_discount_percent = 100, can_delete = true WHERE role = 'admin';

-- 2. Гранулярные права (разделы меню)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS permissions jsonb NOT NULL DEFAULT '{"see_mglass":true,"see_b2b":true,"see_calendar":true,"see_clients":true,"see_earnings":true}'::jsonb;

-- 3. Audit log
CREATE TABLE IF NOT EXISTS activity_log (
  id         bigserial PRIMARY KEY,
  user_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  user_name  text,
  action     text NOT NULL,
  entity_type text,
  entity_id  text,
  details    jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_actlog_entity  ON activity_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_actlog_user    ON activity_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_actlog_created ON activity_log(created_at DESC);

-- 4. Мягкое удаление
ALTER TABLE b2b_orders ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE b2b_quotes ADD COLUMN IF NOT EXISTS archived_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_b2b_orders_archived ON b2b_orders(archived_at) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_b2b_quotes_archived  ON b2b_quotes(archived_at)  WHERE archived_at IS NULL;
```

## СОЗДАНИЕ МЕНЕДЖЕРОВ

Вызови API (один раз, будучи залогиненным как admin):
```
curl -X POST http://localhost:3000/api/admin/seed-managers \
  -H "Cookie: <твои куки из браузера>"
```
Или из консоли браузера на localhost:3000:
```javascript
fetch('/api/admin/seed-managers', {method:'POST'})
  .then(r=>r.json()).then(console.log)
```
Ответ покажет пароли для Александры и Яны.

## Что сделано (сессия 19 мая)

### app/api/admin/seed-managers/route.ts (новый)
- POST → создаёт Александру (02) и Яну (04) с auto-паролями
- Пропускает если email уже существует

### app/b2b-orders/page.tsx
- handleDelete → update archived_at вместо delete
- Запрос добавляет .is('archived_at', null) — архивированные скрыты
- Диалог: "Архивировать?" вместо "Удалить?"

### app/b2b-quotes/page.tsx
- handleDelete → update archived_at
- Запрос добавляет .is('archived_at', null)
- Toast: "Просчёт архивирован"

### app/admin/activity-log/page.tsx (новый)
- Таблица последних 500 действий
- Фильтр по действию и сотруднику
- Показывает дату/сотрудника/действие/объект/детали
- Если таблица не создана → инструкция по миграции

### components/Sidebar.tsx
- "Лог действий" добавлен в ADMIN_OWNER и CEO_OWNER

## Контекст
- TypeScript: 0 ошибок
- Soft delete работает как .update({ archived_at }) → данные в БД сохраняются
- Admin всегда видит всё (permissions не проверяются для admin роли)
- Менеджеры (Семён 05, Айжан 03) уже есть; Александра 02 и Яна 04 создаются через seed API

## Следующий этап
- Страница архива: /admin/archive показывает archived_at IS NOT NULL заказы
- Версионность: сохранять снапшот заказа при изменении цены/скидки
- Discount cap: проверка max_discount_percent в калькуляторе зеркал
