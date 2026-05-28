## Текущая задача
CFO Center MVP — реализован, задокументирован, ждёт деплоя

## Что сделано (сессия 27 мая)

### CFO Center — новый финансовый раздел
- `lib/getRole.ts` — добавлена роль `cfo` с маршрутами; `/cfo` добавлен в список CEO
- `components/Sidebar.tsx` — CFO-блок навигации (Дашборд, Маржинальность, Unit-экономика, Финмодели, Настройки); CEO видит ссылку "CFO Center"
- `app/cfo/layout.tsx` — guard: только admin/ceo/cfo
- `app/cfo/page.tsx` — Server Component дашборд: KPI месяца, алерты, последние расчёты, распределение маржи, выручка по продуктам
- `app/cfo/margins/page.tsx` — Client Component: таблица маржинальности с периодами и фильтрами
- `app/cfo/unit/page.tsx` — Client Component: unit-экономика, разбивка себестоимость → прибыль

### Документация
- `PROJECT_RULES.md` — правила разработки (финансовая формула, AmoCRM readonly, роли, стиль)
- `docs/CFO_CENTER.md` — архитектура CFO Center, маршруты, источники данных, пороги маржи
- `docs/CFO_PERMISSIONS.md` — матрица доступа, назначение ролей

## Следующий шаг
Следующие функции CFO Center (по приоритету):
1. ДДС с ручным вводом (интерфейс к `/admin/cfo/`)
2. P&L по периодам (план vs факт)
3. Удалить финансовые блоки из CEO-раздела (они теперь в CFO Center)

## Контекст
- Налог: 12% для всех продуктов (mirror, mirror_light, loft, shower, shower_standard, shower_budget)
- Пороги маржи: красный <25%, янтарный 25-35%, зелёный ≥35%
- Данные берутся из `calculations` таблицы Supabase (cost_breakdown + financial_breakdown JSON)
- Supabase service role key — только в Server Components
- TypeScript чистый (кроме pre-existing ошибок в __tests__)

## Открытые вопросы
- Нужно ли убрать финансовые блоки из `/ceo/`? (пока оставлены)
- Нужна ли страница `/cfo/dds` с ручным вводом ДДС?
