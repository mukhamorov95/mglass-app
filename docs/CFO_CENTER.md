# CFO Center — Архитектура и функциональность

> Единственный источник финансовой правды в M-Glass App.

---

## Маршруты

| Маршрут | Тип | Описание |
|---------|-----|----------|
| `/cfo` | Server Component | Дашборд: KPI текущего месяца, последние расчёты, распределение маржи |
| `/cfo/margins` | Client Component | Таблица маржинальности с фильтрами по периоду и уровню маржи |
| `/cfo/unit` | Client Component | Unit-экономика: себестоимость → прибыль по каждому расчёту |
| `/admin/cfo` | Client Component | Финмодели, ДДС, ценовые стратегии (доступно также CEO) |
| `/admin/pnl` | Server Component | P&L отчёт |
| `/admin/settings` | Client Component | Финансовые настройки (financial_settings таблица) |

---

## Доступ

Файл: `app/cfo/layout.tsx`

Роли с доступом: `admin`, `ceo`, `cfo`

```typescript
if (!role || !['admin', 'ceo', 'cfo'].includes(role)) redirect('/')
```

---

## Роль `cfo`

Добавлена в `lib/getRole.ts`:

```typescript
cfo: ['/', '/cfo', '/admin/cfo', '/admin/pnl', '/admin/settings', '/admin/dashboard', '/admin/analytics-mglass'],
```

CFO видит свои финансовые страницы, но не `/admin/users`, не `/manager`, не `/commercial`.

---

## Сайдбар

CFO получает отдельный раздел в `components/Sidebar.tsx`:

```typescript
const CFO_ITEMS = [
  { href: '/cfo',            label: 'Дашборд CFO',    icon: '📊' },
  { href: '/cfo/margins',    label: 'Маржинальность', icon: '📈' },
  { href: '/cfo/unit',       label: 'Unit-экономика', icon: '🔍' },
  { href: '/admin/cfo',      label: 'Финмодели / ДДС', icon: '💰' },
  { href: '/admin/settings', label: 'Фин. настройки', icon: '⚙️' },
]
```

CEO также видит ссылку "CFO Center" в своём меню (`CEO_OWNER` список).

---

## Источники данных

| Данные | Таблица Supabase | Колонки |
|--------|-----------------|---------|
| Расчёты КП | `calculations` | `id, created_at, product_type, final_price, base_price, discount, margin, profit, status, client_name, cost_breakdown, financial_breakdown` |
| Ценообразование | `financial_settings` | `product_type, default_margin, tax_percent, min_margin, max_discount_percent` |
| Пользователи | `users` | `id, name, role` |

Связь: `calculations.created_by` → `users.id` (JOIN через `creator:users!created_by(name)`)

---

## Финансовая формула

```
Цена = Себестоимость / (1 − маржа% − налог%)
```

- Налог: **12%** для всех продуктов
- `cost_breakdown.totalCost` — себестоимость (материалы, работа)
- `financial_breakdown.serviceLines` — услуги (монтаж, доставка)
- `profit` = `final_price` − `totalCost` − налог
- `margin` = (`final_price` − `totalCost`) / `final_price` × 100

---

## Пороги маржи

| Цвет | Условие | CSS |
|------|---------|-----|
| Красный (критично) | margin < 25% | `bg-red-50 text-red-700` |
| Янтарный (ниже цели) | 25% ≤ margin < 35% | `bg-amber-50 text-amber-700` |
| Зелёный (норма) | margin ≥ 35% | `bg-emerald-50 text-emerald-700` |

---

## Что планируется (следующие итерации)

- **ДДС с ручным вводом** — интерфейс к уже существующей логике в `/admin/cfo/`
- **P&L по периодам** — месяц / квартал / год, план vs факт
- **Планирование выручки** — ввод плана, автоматический прогноз из текущих сделок
- **Комиссии менеджерам** — расчёт на основе маржи сделок
- **AI-рекомендации** — на основе паттернов в данных расчётов
- **Импорт** — загрузка банковских выписок для сверки с AmoCRM
