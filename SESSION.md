## Текущая задача
Step 10 — Supervisor Panel — РЕАЛИЗОВАНО, ожидает подтверждения и коммита

## Что сделано (эта сессия)
- Step 7 — экран фиксации проблем:
  - lib/productionStages.ts → добавлены PROBLEM_REASONS (9 причин) + поле reason в DetailStageState
  - app/production-app/orders/[id]/page.tsx → ProblemModal компонент (выбор причины + комментарий)
  - markStage('problem') теперь открывает модал вместо немедленной записи
  - saveProblem(reason, note) сохраняет reason + note в notes.detail_stages[idx].problem
- Step 3 — роли и доступ:
  - lib/getRole.ts → убран /b2b-orders из роли production
  - middleware.ts → production-пользователь с / редиректится на /production-app
  - components/Sidebar.tsx → убраны мёртвые ссылки /b2b-orders и /manager-dashboard из PRODUCTION_ITEMS
- Step 4 — главный экран:
  - app/production-app/page.tsx → server component, загружает b2b_orders, считает 4 счётчика, список заказов по дедлайну
- Step 5 — экран заказа:
  - app/production-app/orders/[id]/page.tsx → полный client component, список деталей, групповые действия, запись в notes.detail_stages
- Step 6 — QR Compatibility Check:
  - lib/productionStages.ts → создан общий helper с типами и логикой этапов
  - app/p/o/[orderId]/page.tsx → переведён на импорт из productionStages
  - app/production-app/orders/[id]/page.tsx → переведён на импорт, добавлена ссылка "QR-экран" → /p/o/{id}
- Step 10 — Supervisor Panel (НОВОЕ):
  - app/production-app/supervisor/page.tsx → СОЗДАН (server component)
  - components/Sidebar.tsx → добавлена "Панель производства" в CEO_OWNER и ADMIN_OWNER
  - components/Sidebar.tsx → /production-app добавлен в autoOpenAdmin (ceo mode) и autoOpenRole (ceo role)

## Step 10 — Supervisor Panel — детали

### Маршрут
/production-app/supervisor

### Доступ
- admin: всегда (canAccess → return true)
- ceo: через /production-app в ROLE_ALLOWED.ceo (уже покрывает /production-app/*)
- production/manager: redirect → /production-app (проверка role внутри страницы)

### Что показывает
- Статкарды: Активных / Просрочено / Проблемы / Упаковано
- Табы-фильтры: Все / Просрочено / Проблемы / Сегодня—Завтра / Упаковано (URL searchParams)
- Список заказов: сортировка overdue → today → tomorrow → normal → ready, проблемные наверх внутри группы
- Карточка заказа: лейбл + клиент + дедлайн-бейдж + прогресс-бар упаковки + список проблем с позицией и причиной
- Ссылки на каждой карточке: → Заказ (/production-app/orders/{id}) + → QR-экран (/p/o/{id})

### Сайдбар
- CEO_OWNER: добавлена "Панель производства" 🔭 после "Production App"
- ADMIN_OWNER (CEO-view для admin): то же
- autoOpen: /production-app в списке owner-аккордеона для обоих режимов

### TypeScript
Ошибок в новом коде нет. Pre-existing ошибки в __tests__/calculators/mirror.test.ts — не затронуты.

## Production App: QR Compatibility Check — ЗАКРЫТО

### Коммит
be0ed58 — feat(production-app): align order screen with qr workflow

### Что закрыто
/p/o/{id} и /production-app/orders/{id} теперь используют общий источник типов и логики этапов.

### Новый общий helper
lib/productionStages.ts

## Production App: Step 8 Manual Production Validation — ЗАКРЫТО

### Проверенный заказ
#609

### Что подтвердили
- Production App открывает реальный заказ;
- QR-ссылка открывает /p/o/609;
- QR-экран загружает тот же заказ;
- отметки этапов синхронизируются между Production App и QR-экраном;
- отметки видны в /b2b-orders в прогрессе по деталям;
- общий формат notes.detail_stages работает;
- back-link на QR-экране ведёт в /production-app.

## Access Control: Root Route Matching Fix — ЗАКРЫТО

### Коммит
be4f698 — fix(access): restrict root route matching

### Что было не так
'/' в ROLE_ALLOWED фактически открывал все маршруты (p === '/' всегда true внутри allowed.some).

### Что исправлено
Теперь p === '/' разрешает только pathname === '/'.

## Следующий шаг
Дать отчёт пользователю и ждать подтверждения для коммита.

## Контекст
- Production App: /production-app (главный экран) + /production-app/orders/{id} (экран заказа)
- Supervisor Panel: /production-app/supervisor (только admin/ceo)
- Данные: b2b_orders.notes.detail_stages — единый источник для обоих интерфейсов
- lib/productionStages.ts — общий helper для типов и логики зеркал/закалки
- Главный экран: server component, фильтрует по notes.status != 'quote' + archived_at IS NULL
- Счётчики: Активных / Просрочено / Проблемы / Упаковано
- Сортировка: overdue → today → tomorrow → normal → ready → shipped

## Открытые вопросы
- PWA manifest: добавить на позднем шаге
- Снятие ошибочной отметки этапа (undo)
- История изменений по детали (кто/когда)
