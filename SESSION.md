## Текущая задача
Завершено: Snapshot-защита расчётов + документация Skills (в процессе — агент)

## Что сделано (сессия 26 мая)

### КРИТИЧЕСКИЙ БАГ-ФИКС: Стабильность сохранённых расчётов

#### Баг 1 — CartSection сохранял неправильную цену
- `components/CartSection.tsx` — `final_price: item.grand_total` вместо `item.final_price`
  (cart хранил цену без услуг, а прямое сохранение — с услугами → расхождение)

#### Баг 2 — "Пересчитать" перезаписывал оригинальный snapshot
- `app/calculator/mirror/page.tsx` — Edit mode теперь ВСЕГДА сохраняет как новый расчёт
  с `parent_calc_id = editCalcId`, никогда не вызывает `updateCalculation`
- Добавлен баннер "Режим пересчёта #N" с отображением "Было X₽ → Сейчас Y₽ (+/-Δ)"
- Кнопка меняется на "Сохранить как новый расчёт" (янтарный цвет)

#### Баг 3 — getPreview() неверно считал profit при наличии услуг
- `app/calculations/[id]/page.tsx` — `getPreview()` теперь возвращает `calc.profit` и
  `calc.margin` напрямую из БД если цена/скидка не изменились. Пересчёт только при явном
  изменении пользователем.

#### Новый flow: "Пересчитать по актуальным ценам"
- `app/calculations/[id]/page.tsx`:
  - Кнопка "Пересчитать" → модальное окно с предупреждением
  - Модалка: объясняет что оригинал останется нетронутым, новый calc создастся отдельно
  - `openInCalculator()` теперь передаёт `__old_final_price__` для отображения diff в калькуляторе
  - Баннер "↩ Это пересчёт расчёта #N" (если есть parent_calc_id)
  - Баннер "Пересчитан → #N (Y₽ · дата)" (если есть дочерние версии)

#### Полный input_data snapshot
- `app/calculator/mirror/page.tsx` `handleAddToCart()` и `handleSave()`:
  теперь включают ВСЕ параметры: voltage, frameId, ledStripId, psuId, diffuserId, hasFrame,
  mirrorFrameId, hasFacet, facetTypeMm, substratePrice, hasInstallation, hasDelivery, kmFromMkad,
  partnerId, discount, margin

#### Новая колонка в БД
- `lib/saveCalculation.ts` — добавлено поле `parent_calc_id?: number` в SavePayload

### ⚠️ SQL МИГРАЦИЯ ДЛЯ ДЕПЛОЯ
```sql
-- Версионирование расчётов (обязательно перед использованием "Пересчитать по актуальным ценам")
ALTER TABLE calculations
  ADD COLUMN IF NOT EXISTS parent_calc_id bigint REFERENCES calculations(id);

-- Ранее незадеплоенные (из предыдущей сессии):
ALTER TABLE b2b_materials
  ADD COLUMN IF NOT EXISTS supplier_id            bigint REFERENCES suppliers(id),
  ADD COLUMN IF NOT EXISTS supplier_material_name text;

ALTER TABLE glass_price_matrix
  ADD COLUMN IF NOT EXISTS supplier_id            bigint REFERENCES suppliers(id),
  ADD COLUMN IF NOT EXISTS supplier_material_name text;
```

### Документация Skills (агент работает в фоне)
- Запущен анализ всего проекта + создание docs/ и skills/ с 16+ файлами

## Что сделано (сессия 25 мая)

### Health-check → центр диагностики MGlass
- `app/admin/health-check/page.tsx` — карточки проблем, автоисправления, инструкции, журнал, роли
- `app/api/admin/health-check/fix/route.ts` — API автоисправлений (sync_b2b_materials, sync_b2b_from_glass, fix_roles_null)
- `lib/healthCheckRunner.ts` — shared-модуль: 25 проверок, INITIAL_CHECKS, ISSUE_META, runChecks()

### AI Control Center — единый центр управления MGlass
- `app/admin/ai-control-center/page.tsx` — 6-вкладочный хаб: обзор, health, калькуляторы, AI-анализ, рекомендации, журнал
- `app/api/admin/ai-control-center/analyze/route.ts` — Claude API (claude-sonnet-4-6), 5 перспектив, JSON рекомендации
- `components/Sidebar.tsx` — AI Control Center в OWNER CENTER, health-check убран из Система
- `lib/getRole.ts` — ceo получил доступ к /admin/ai-control-center

## Изменённые файлы (26 мая)
- `components/CartSection.tsx` — bug fix: grand_total как final_price
- `lib/saveCalculation.ts` — добавлен parent_calc_id
- `app/calculator/mirror/page.tsx` — полный fix: input_data, edit mode, баннер diff
- `app/calculations/[id]/page.tsx` — fix: getPreview, recalc modal, версионный chain

## Следующие возможные задачи
- Задеплоить SQL миграции (parent_calc_id + supplier fields)
- Применить аналогичные фиксы к loft/page.tsx и shower/page.tsx (те же cart/edit bugs)
- Ознакомиться с документацией Skills после завершения агента
- Загрузка прайсов к поставщикам (PDF/Excel attachment)
- История изменений поставщика
