# CFO Finmodel Architecture

## Обзор

`/admin/cfo/` — финансовый центр CFO. Содержит P&L-модель, ценообразование, ДДС, график выручки и настройки постоянных затрат.

---

## Маршруты и доступ

| Маршрут | Роли |
|---|---|
| `/admin/cfo/` | admin, ceo, cfo |

Guard реализован в `app/admin/cfo/page.tsx`:
```ts
if (role !== 'admin' && role !== 'ceo' && role !== 'cfo') redirect('/')
```

---

## Структура файлов

```
app/admin/cfo/
  page.tsx          — Server Component: фетч данных, передача в CfoClient
  CfoClient.tsx     — Client Component: весь UI (~900 строк)

app/api/cfo-settings/
  route.ts          — POST: сохранение настроек в cfo_settings
```

---

## Источники данных

| Данные | Источник | Таблица / API |
|---|---|---|
| Постоянные затраты | Supabase | `cfo_settings` (id=1) |
| Выручка 12 мес | Supabase | `calculations` (status=approved) |
| Факт текущего месяца | Supabase | `calculations` (≥monthStart, ≠cancelled) |
| Маржинальность (pricing) | Supabase | `financial_settings` |
| План выручки по направлениям | localStorage | ключ `cfo_rev_plan` |
| Фонды распределения | localStorage | ключ `cfo_funds` |

---

## Структура P&L (финансовая модель)

```
ДОХОДЫ (по 6 направлениям)
  Зеркала / перегородки (B2C)   VC=62%
  Душевые кабины (B2C)          VC=62%
  Лофт-перегородки (B2C)        VC=62%
  Монтаж и доставка             VC=25%
  B2B Стекло / Металл           VC=49%
  Прочие доходы                 VC=40%
──────────────────────────────────────
ПЕРЕМЕННЫЕ РАСХОДЫ (VC)
  = Σ (revenue_dir × vcPct_dir)
──────────────────────────────────────
МАРЖИНАЛЬНАЯ ПРИБЫЛЬ
  = Выручка − Переменные расходы
──────────────────────────────────────
ПОСТОЯННЫЕ РАСХОДЫ (FC)
  Аренда, Коммунальные, ФОТ, Налоги с ФОТ,
  Лизинг, Кредит, Маркетинг, Аутсорс, Прочее
──────────────────────────────────────
EBITDA
  = Маржинальная прибыль − FC
──────────────────────────────────────
ФОНДЫ РАСПРЕДЕЛЕНИЯ (настраиваемые)
  Например: Дивиденды 20%, Обучение 5%, Резерв 5%
──────────────────────────────────────
ЧИСТАЯ ПРИБЫЛЬ
  = EBITDA × (1 − Σ fundsPct)
```

---

## Формулы

### Переменные затраты
```
totalActualVC = Σ_dir (actual_dir.revenue × vcPct_dir / 100)
totalPlanVC   = Σ_dir (plan_dir × vcPct_dir / 100)
```

### Маржинальная прибыль
```
actualMargProfit = totalActualRev − totalActualVC
planMargProfit   = totalPlanRev   − totalPlanVC
```

### EBITDA
```
actualEBITDA = actualMargProfit − totalFC
planEBITDA   = planMargProfit   − totalFC
```

### Фонды
```
fundsPct      = Σ fund.pct / 100   (только включённые фонды)
planFundsTotal = planEBITDA × fundsPct
```

### Чистая прибыль
```
planNet   = planEBITDA   × (1 − fundsPct)
actualNet = actualEBITDA × (1 − fundsPct)
```

### Точки безубыточности

**ТБ0** — покрытие только постоянных затрат:
```
TB0 = totalFC / (1 − weightedVC%)
```
где `weightedVC% = totalActualVC / totalActualRev` (или fallback к `settings.avg_variable_pct / 100`)

**ТБ1** — покрытие FC + фондов:
```
TB1 = totalFC / ((1 − weightedVC%) × (1 − fundsPct))
```

---

## Маппинг направлений (PRODUCT_TO_DIR)

Определён в `app/admin/cfo/page.tsx`:

| product_type | Направление |
|---|---|
| mirror, mirror_light | b2c_mirror |
| shower, shower_standard, shower_budget | b2c_shower |
| loft | b2c_loft |
| всё остальное | other |

`b2c_services` заполняется из `financial_breakdown.servicesTotal` по всем записям.  
`b2b_glass` не агрегируется автоматически (данные вводятся вручную через план).

---

## Агрегация факта (page.tsx)

```ts
for (const c of monthCalcsAll) {
  const dir   = PRODUCT_TO_DIR[c.product_type] ?? 'other'
  const cost  = c.cost_breakdown?.totalCost ?? 0
  const svcRev = c.financial_breakdown?.servicesTotal ?? 0

  monthActuals[dir].revenue += c.final_price ?? 0
  monthActuals[dir].cost    += cost
  monthActuals.b2c_services.revenue += svcRev
}
```

---

## Хранение данных

### cfo_settings (Supabase)

| Поле | Тип | Описание |
|---|---|---|
| id | int (=1) | Singleton-запись |
| entity_type | text | 'ip' / 'ooo' |
| tax_system | text | 'usn_6' / 'usn_15' / 'osn' |
| fixed_costs | jsonb | 9 статей FC (рублей/мес) |
| profit_split | jsonb | owner_pct, education_pct, reserve_pct |
| avg_variable_pct | int | Средний % переменных затрат |
| monthly_revenue_target | int | Целевая выручка/мес |
| updated_at | timestamptz | Время последнего сохранения |

### localStorage

| Ключ | Структура | Назначение |
|---|---|---|
| `cfo_rev_plan` | `Record<dirId, number>` | План выручки по направлениям |
| `cfo_funds` | `Fund[]` | Список фондов (id, label, pct, enabled) |

---

## Вкладки

| Вкладка | ID | Описание |
|---|---|---|
| Финмодель | finmodel | P&L таблица + правая панель (ТБ + AI) |
| Ценообразование | pricing | Таблица маржей по продуктам |
| ДДС | dds | Сценарии + таблица движения денег |
| График | chart | Выручка за 12 месяцев |
| Настройки | settings | Редактирование FC, entity_type, tax_system |

---

## AI-инсайты (rule-based)

Реализованы в `buildInsights()` в `CfoClient.tsx`. 7 условий:

| Условие | Инсайт |
|---|---|
| actualEBITDA > 0 | EBITDA в плюсе — дистрибуция возможна |
| actualEBITDA < 0 | EBITDA отрицательный — кризис ликвидности |
| actualRev / planRev < 0.5 | Выручка ниже 50% плана |
| actualRev / planRev > 0.8 | Выручка выше 80% плана |
| actualRev > TB1 | Прошли ТБ1 — чистая прибыль в плюсе |
| actualRev > TB0, actualRev < TB1 | Между ТБ0 и ТБ1 |
| actualRev < TB0 | Ниже ТБ0 — убыток |

---

## Versioning и Snapshots

**Текущая реализация:** plan хранится в localStorage — нет версионирования.

**Следующий шаг (не реализован):** сохранять снапшоты плана в Supabase:
```sql
CREATE TABLE cfo_plan_snapshots (
  id         bigserial PRIMARY KEY,
  month      text,         -- '2025-06'
  rev_plan   jsonb,        -- Record<dirId, number>
  funds      jsonb,        -- Fund[]
  created_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES auth.users(id)
);
```

---

## Риски

| Риск | Статус |
|---|---|
| localStorage очищается при выходе/режиме инкогнито | Есть default fallback, но план теряется |
| b2b_glass факт = 0 (нет данных из CRM) | Принять как ограничение, ввод вручную не реализован |
| VC% направлений заданы хардкодом в REV_DIRS | Нужно вынести в cfo_settings |
| Снапшоты плана не сохраняются | Нужна таблица cfo_plan_snapshots |

---

## Дефолтные значения (из ТБ1)

```
FC = 2 868 890 ₽/мес
  Аренда:          475 000
  Коммунальные:     20 000
  ФОТ:             800 000
  Налоги с ФОТ:    181 000
  Лизинг:          505 200
  Кредит:          344 980
  Маркетинг:       290 000
  Аутсорс:         190 000
  Прочее:           62 710

Средний VC:   62%
Целевая выручка: 8 700 000 ₽/мес
```

Взвешенный VC рассчитан из ТБ1: Glass 43.7% + MGlass 69.1% (оба без налога), взвешен по доле выручки.
