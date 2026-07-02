## Текущая задача
Дизайн-система M-Glass (Вариант 3 «карточки-строки») — раскатка на всё приложение.
Ветка `design-system` (worktree `mglass-design`), изолирована от `main`.

## Что сделано (эта сессия)
- Ф0 Токены → `app/globals.css` (@theme: ink/ink-soft/muted/faint/canvas/surface/subtle/line/line-soft)
- Ф1 Библиотека примитивов → `components/ds.tsx` (PageHeader, SegmentedTabs, Field, SelectField,
  SectionHeader, RowCard, StatusPill, IconButton, MetricTile, EmptyState, SkeletonRows, Ic*)
- Ф1 Дока → `docs/DESIGN_SYSTEM.md`
- Ф2 Эталонная страница → `app/admin/archive/page.tsx` переписана на ds (логика сохранена дословно)

## Следующий шаг
Ф3 — перевести `components/Sidebar.tsx` на токены/язык системы (задевает все страницы),
затем Ф4 — раскатка по разделам (manager → admin → cfo → b2b → production → marketing).

## Контекст
- Раскатка централизованная: палитра не меняется, меняем форму через ds.tsx + токены.
- Хардкод-палитра в проекте ~5200+ раз → CSS-переменные сами не пропагируются; язык идёт
  через общие компоненты. Мигрируем страницы на примитивы ds по разделам.
- Не трогать логику страниц. Не трогать вторую ветку (main / mglass-app).

## Открытые вопросы
- Sidebar (857 строк, ~300 className) — крупная правка; делать аккуратно, проверить все роли.
- Merge design-system → main — только после build + визуальной проверки разделов.
