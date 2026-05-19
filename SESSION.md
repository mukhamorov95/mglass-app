## Текущая задача
Фацет — реализован, нужна SQL-миграция в Supabase

## SQL МИГРАЦИИ (ВЫПОЛНИТЬ В SUPABASE!)

```sql
-- Таблица цен фацета
CREATE TABLE IF NOT EXISTS facet_prices (
  id             serial PRIMARY KEY,
  type_mm        integer NOT NULL,
  cost_price     numeric(10,2) NOT NULL DEFAULT 0,
  transport_cost numeric(10,2) NOT NULL DEFAULT 0,
  sale_price     numeric(10,2) NOT NULL DEFAULT 0,
  active         boolean NOT NULL DEFAULT true,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Начальные 3 строки (заполнить цены в админке)
INSERT INTO facet_prices (type_mm, cost_price, transport_cost, sale_price) VALUES
  (10, 0, 0, 0),
  (15, 0, 0, 0),
  (20, 0, 0, 0);
```

После миграции:
1. Зайди в /admin/facet → заполни цены (себест. подрядчика, транспорт, цена клиенту) для 10/15/20 мм
2. В B2B калькуляторе появятся чекбокс «Фацет» и дропдаун выбора типа

## Что сделано (сессия 19 мая — фацет)

### lib/b2bCalculator.ts
- Добавлен тип `FacetPrice` (type_mm, cost_price, transport_cost, sale_price)
- В `B2BOrderItem` добавлены поля: `hasFacet`, `facetTypeMm`, `costFacet`, `saleFacet`
- `calcItem()` принимает `hasFacet`, `facetTypeMm`, `facetPrices[]`
- Расчёт: `perimeterM × quantity × (cost_price + transport_cost)` → costFacet
- Расчёт: `perimeterM × quantity × sale_price` → saleFacet
- saleFacet добавляется к saleIncVat; costFacet добавляется к costWithVatBase

### app/calculator/b2b/page.tsx
- Состояния: `fFacet`, `fFacetMm`, `eFacet`, `eFacetMm`, `facetPrices`
- Загрузка facet_prices из Supabase в load()
- UI: чекбокс «Фацет» + дропдаун типа (показывается только если есть цены в БД)
- Edit modal: аналогичные поля
- Таблица позиций: бейдж «фацет 10мм» (фиолетовый)
- КП текст: добавляет «фацет Xмм» к описанию материала

### app/admin/facet/page.tsx (новый)
- CRUD для 3 строк (10/15/20 мм): in-place редактирование
- Показывает пример расчёта для детали 600×800 мм 3шт
- Если таблица не создана → инструкция по миграции

### components/Sidebar.tsx
- Добавлена ссылка «💎 Фацет» в раздел ADMIN_B2B

## Предыдущие миграции (уже выполнены 19 мая)

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS max_discount_percent integer NOT NULL DEFAULT 5;
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_delete boolean NOT NULL DEFAULT false;
UPDATE users SET max_discount_percent = 100, can_delete = true WHERE role = 'admin';
ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions jsonb NOT NULL DEFAULT '{"see_mglass":true,"see_b2b":true,"see_calendar":true,"see_clients":true,"see_earnings":true}'::jsonb;
CREATE TABLE IF NOT EXISTS activity_log (
  id bigserial PRIMARY KEY, user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  user_name text, action text NOT NULL, entity_type text, entity_id text,
  details jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_actlog_entity  ON activity_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_actlog_user    ON activity_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_actlog_created ON activity_log(created_at DESC);
ALTER TABLE b2b_orders ADD COLUMN IF NOT EXISTS archived_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_b2b_orders_archived ON b2b_orders(archived_at) WHERE archived_at IS NULL;
```

## Контекст
- TypeScript: 0 ошибок
- Фацет: расчёт по м.п. периметра × кол-во; не по площади
- facetPrices = [] → UI не показывает чекбокс фацета (безопасно до миграции)
- Менеджеры 02 (Александра) и 04 (Яна) создаются через /api/admin/seed-managers

## Следующий этап
- Заполнить цены фацета в /admin/facet
- Страница архива: /admin/archive (archived_at IS NOT NULL)
- Discount cap: проверка max_discount_percent в калькуляторе
