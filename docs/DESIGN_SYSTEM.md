# Дизайн-система M-Glass (Вариант 3 — «карточки-строки»)

Единый визуальный язык для всего приложения. Референс — apple.com: простота, воздух,
миниатюрность, чистая типографика. Раскатывается **централизованно** через токены и
общие компоненты, а не правкой каждой из ~80 страниц.

## Где живёт система (3 точки)
1. **Токены** — `app/globals.css` (`@theme`). Нейтральная палитра проекта, названная
   по ролям. Утилиты Tailwind v4: `text-ink`, `bg-surface`, `border-line`, `bg-subtle`, …
2. **Примитивы** — `components/ds.tsx`. Ядро Варианта 3.
3. **Оболочка** — `components/Sidebar.tsx` (рендерится на всех страницах) — переводится
   на язык системы в Фазе 3.

## Токены (globals.css)
| Токен | Значение | Роль |
|---|---|---|
| `ink` | `#111110` | основной текст, тёмные кнопки |
| `ink-soft` | `#6b6b66` | вторичный текст, ghost-кнопки |
| `muted` | `#9a9a95` | подписи, мета |
| `faint` | `#c4c4be` | плейсхолдеры, иконки в покое |
| `canvas` | `#f8f8f7` | фон страницы |
| `surface` | `#ffffff` | карточки, поля |
| `subtle` | `#fafaf9` | hover-фон, плитки, скелетон |
| `line` | `#e4e4e0` | границы |
| `line-soft` | `#f0f0ec` | тонкие разделители |

Статусы — семантические тона (`success/warning/accent/danger/neutral/strong`) на палитре
Tailwind (emerald/amber/blue/red).

## Примитивы (components/ds.tsx)
`PageHeader` · `SegmentedTabs` · `Field` · `SelectField` · `SectionHeader` · `RowCard`
(ядро) · `StatusPill` · `IconButton` · `MetricTile` · `EmptyState` · `SkeletonRows` +
inline-иконки `Ic*` (Lucide-стиль, без зависимостей).

Компоненты презентационные (без хуков) → используются и в server-, и в client-страницах.

## Как перевести страницу на систему
1. `import { … } from '@/components/ds'`.
2. Заголовок → `<PageHeader title subtitle actions />`.
3. Вкладки → `<SegmentedTabs />`; поиск/фильтры → `<Field icon> / <SelectField>`.
4. Таблицы-списки → группа `<SectionHeader />` + стек `<RowCard />`.
5. Статусы → `<StatusPill tone>`; действия-иконки → `<IconButton>`.
6. Пусто/загрузка → `<EmptyState />` / `<SkeletonRows />`.
7. Хардкод `#111110/#9a9a95/#e4e4e0…` → токены `text-ink/text-muted/border-line`.
8. **Логику не трогать** — меняем только представление.

Эталон: `app/admin/archive/page.tsx`.

## Алгоритм раскатки (фазы)
- **Ф0** Токены (`globals.css`) — ✅
- **Ф1** Библиотека `ds.tsx` + эта дока — ✅
- **Ф2** Эталонная страница (архив) — ✅
- **Ф3** `Sidebar` на язык системы (задевает все страницы)
- **Ф4** Раскатка по разделам: manager → admin → cfo → b2b → production → marketing
- **Ф5** `npm run build` + визуальная проверка каждого раздела → merge `design-system → main`

## Правила
- Ветка `design-system` (worktree `mglass-design`). Изолирована от `main` (фичи).
- Палитра не меняется — меняются форма, отступы, радиусы, иконки, типографика.
- Без новых зависимостей; влияние на скорость загрузки ~нулевое.
