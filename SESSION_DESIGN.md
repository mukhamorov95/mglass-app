## Текущая задача
Дизайн-система M-Glass (Вариант 3 «карточки-строки») — раскатка на всё приложение.
Ветка `design-system` (worktree `mglass-design`), изолирована от `main`.

## Что сделано (эта сессия)
- Ф0 Токены → `app/globals.css` (@theme: ink/ink-soft/muted/faint/canvas/surface/subtle/line/line-soft)
- Ф1 Библиотека примитивов → `components/ds.tsx` (PageHeader, SegmentedTabs, Field, SelectField,
  SectionHeader, RowCard, StatusPill, IconButton, MetricTile, EmptyState, SkeletonRows, Ic*)
- Ф1 Дока → `docs/DESIGN_SYSTEM.md`
- Ф2 Эталонная страница → `app/admin/archive/page.tsx` переписана на ds (логика сохранена дословно)
- Ф3 Sidebar → `components/Sidebar.tsx` нейтральная палитра переведена на токены
  (ink/ink-soft/muted/faint/line/line-soft). Ролевые акценты и логика не тронуты.
  Фикс бага: `border-[#ebebе8]` (кириллическая «е», невалидный цвет) → `border-line`.

## Ф4 — раскатка по разделам (в процессе)
Готово (build ✓, отдельные коммиты): calculations, orders, b2b-quotes, admin/dashboard.
Паттерн: субагент мигрирует (визуал-только, rich-карточки ретокенизируем на месте,
не впихивая в RowCard) → build → коммит.

## Ф4 — готово (15 коммитов, каждый build ✓)
archive, Sidebar, calculations, orders, b2b-quotes, admin/dashboard, manager,
manager-dashboard, b2b-orders, cfo×3, clients, b2b-crm, b2b-cutting, b2b-analytics,
calendar, measurer, my-earnings, my-dashboard, my-notes, production-app(5 дашбордов),
marketing(6 ядро), ceo, commercial, production. Найдено+исправлено 2 бага border-[#ebebе8].

## Осталось (длинный хвост, реже используется)
- production-app: station/[station], material, docs, cutting, orders/[id]
- marketing: video-factory, media-library, videos, ai
- admin/* конфиг: ~50 подстраниц (users уже поменяла вторая сессия — не трогать конфликтно)
- ai-*: ai-assistant, ai-sales, ai-stats, amo-analysis, kp-generator, vladislav/*, ai-b2b-quote
- прочее: objections, templates, competitors, deal-analysis, product-finder, materials,
  cart, academy, appointments, agents

## Merge
main ушёл на 3 коммита (users/groups PR), пересечений с design-system НЕТ → merge чистый.
Порядок: git merge design-system → main → push (деплой), только с явного согласия владельца.

## Контекст
- Раскатка централизованная: палитра не меняется, меняем форму через ds.tsx + токены.
- Хардкод-палитра в проекте ~5200+ раз → CSS-переменные сами не пропагируются; язык идёт
  через общие компоненты. Мигрируем страницы на примитивы ds по разделам.
- Не трогать логику страниц. Не трогать вторую ветку (main / mglass-app).

## Открытые вопросы
- Sidebar (857 строк, ~300 className) — крупная правка; делать аккуратно, проверить все роли.
- Merge design-system → main — только после build + визуальной проверки разделов.
