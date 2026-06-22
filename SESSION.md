## Текущая задача
Авторизация: единая модель для UI и API — ЗАКРЫТО + ревью пройдено, build ОК

## Что сделано (эта сессия)
- fix(auth): UI guards для CEO (часть 1)
  - lib/getRole.ts — `OWNER_ROLES = ['admin','ceo']`, `isOwnerRole`, `normalizeRole`, `canAccessRoute` (короткое замыкание для owner ролей), email-bootstrap для admin@mglass.ru
  - middleware.ts — использует canAccessRoute + normalizeRole; убран хардкод VALID_ROLES (теперь все типобезопасные роли валидны, включая 'cfo')
  - app/admin/owner/page.tsx, app/admin/pnl/page.tsx, app/admin/analytics-mglass/page.tsx, app/admin/pricing-manual/page.tsx, app/b2b-crm/page.tsx, app/production-app/supervisor/page.tsx — все на isOwnerRole

- fix(auth): API helpers + миграция всех API на единую модель (часть 2)
  - lib/apiAuth.ts (новый) — `requireOwner()`, `requireAdmin()`, `isOwnerCurrentUser()`
  - lib/requireOwner.ts — удалён, был email-only check (admin@mglass.ru). Заменён на role-based requireOwner
  - Owner-tier API (admin + ceo через requireOwner): settings, sales-bonuses, sales-scripts, sales-feedback, owner-strategy, users, invite, suppliers (DELETE), suppliers/[id] (DELETE), brigades, brigades/[id], delivery-zones, delivery-zones/[id], shower-images, materials/upload, role-assignments, role-assignments/[id], sync-b2b-materials, pricing-formula, glass-prices (sale write + sale filter), integrations, integrations/backfill, migrate-glass-prices, ai-recommendations, ai-control-center/analyze, health-fix-log, health-check/fix, orders/[id]/approve, orders/[id]/status (isAdmin → isOwner), quotes/[id]/pdf, debug/amo
  - Strictly admin (requireAdmin): sync (git push), seed-managers (массовое создание auth user'ов)
  - Role-specific (без изменений): cfo-settings (admin+ceo+cfo)
  - suppliers POST/PATCH: ALLOWED_WRITE = ['admin','ceo','buyer'] (CEO добавлен)

## Auth fix — review summary

### Финальные проверки (часть 3)
- `npm run build` — ✅ зелёный, 0 ошибок
- `npm run lint` — все warnings/errors предсуществовали, ни одной новой в auth-файлах
- Циклических импортов нет: apiAuth → getRole → supabase-server,permissions
- 27 вызовов `requireOwner()` и 2 вызова `requireAdmin()` все имеют корректный `if (guard instanceof NextResponse) return guard` сразу после
- lib/requireOwner.ts удалён, импортов на него нет
- VALID_ROLES константа удалена (заменена на normalizeRole)

### Кто куда теперь имеет доступ
- **Owner tier (admin + ceo)**: весь UI + все owner-tier API (settings, users, suppliers, brigades, delivery-zones, sales-bonuses, sales-scripts, sales-feedback, owner-strategy, invite, role-assignments, sync-b2b-materials, pricing-formula, glass-prices write, integrations, ai-recommendations, ai-control-center, health-check, orders/approve, orders/status, quotes/pdf, debug/amo, shower-images, materials/upload, migrate-glass-prices)
- **Strictly admin-only**: /api/admin/sync (git push), /api/admin/seed-managers (массовое создание auth users)
- **Role-specific**: /api/cfo-settings — admin/ceo/cfo, без изменений
- **Buyer**: POST/PATCH к /api/admin/suppliers (catalog editing) — но не DELETE и не другие admin endpoints
- **Manager/production/seo/commercial**: без изменений — их allowlist в ROLE_ALLOWED не тронут

### Известные ограничения (не в скоупе текущего фикса)
- Данные-visibility фильтры (`role === 'admin'` в clients/orders/calculations/my-earnings/manager-dashboard) — это бизнес-логика "свои/все", не auth gates. CEO в этих местах ещё попадает в категорию "видит только своё". Отдельная задача.
- `app/calculator/mirror/page.tsx:1162` использует `role === 'owner'` (string) — мёртвый код, normalizeRole мапит 'owner' → 'admin', никакая роль не равна 'owner' после нормализации. Безвредно.
- middleware кеширует role в HTTP-only cookie на 1 час — если admin меняет роль юзера в БД, она применится только после истечения куки или перелогина. Это пре-существующее поведение.

### Причина бага
1. Owner Center меню для CEO ссылалось на admin-only страницы (`/admin/owner`, `/admin/pnl`, `/admin/analytics-mglass`, `/admin/pricing-manual`), которые внутри делали `if (role !== 'admin') redirect('/')`.
2. CEO `ROLE_ALLOWED` в `lib/getRole.ts` не включал `/admin/suppliers`, `/admin/brigades`, `/admin/warehouse`, `/admin/route-sheet`, `/admin/infrastructure`, `/admin/materials` и др. — middleware кидал на `/access-denied`.
3. `middleware.ts:VALID_ROLES` не содержал `'cfo'`, поэтому CFO юзеры падали в null.

### Решение (архитектурное)
- Owner-tier (`admin` + `ceo`) определён в `OWNER_ROLES` и через `isOwnerRole()` короткозамыкает `canAccessRoute` → полный доступ ко всему.
- Per-page guards используют `isOwnerRole(role)` вместо `role === 'admin'` — теперь и CEO, и admin проходят везде одинаково.
- `normalizeRole()` — case-insensitive, маппит UI-алиас `'owner'` → `'admin'`.
- Email-bootstrap для `admin@mglass.ru` — только если в БД нет валидной роли. Не костыль для конкретного юзера, а аварийная страховка.
- Ограниченные роли (manager, production, buyer, seo, commercial, cfo) — не тронуты, остаются со своими allowlist'ами.

## Sales Control Drawer Detail — ЗАКРЫТО

### Коммит
179db87 — feat(admin): show stale deal details in sales-control drawer

### Что добавлено

- `/api/commercial/stats` для периода `today` теперь отдаёт:
  - `domain` — домен AmoCRM для deep links
  - `staleZone1Deals`, `staleZone2Deals`, `staleZone3Deals`, `invoiceStaleDeals` — массивы с `{ id, name, daysStale, stageName }` для каждого менеджера
- Drawer во вкладках "Без касания", "Продажа >3д", "Производство >3д", "Долгострой" теперь показывает реальный список сделок:
  - Название сделки (кликабельная ссылка → AmoCRM `/leads/detail/:id`)
  - Этап сделки
  - Бейдж с количеством дней без движения
- Вкладка "Долгострой" — фильтр из staleZone1: сделки >7д или с этапом "Долгострой"
- Для исторических периодов (неделя/месяц/год) детализация показывает note: "доступна только в режиме Сегодня"

### Что НЕ изменялось
- lib/salesMonitor.ts — не трогался (данные уже были, просто не экспортировались)
- Структура `StaleInfo` в salesMonitor — не менялась
- API для исторических периодов (sales_monitor_daily) — не менялось, списков сделок там нет

## Production App: Step 13+ — ЗАКРЫТО

Весь блок Production App завершён (13 шагов: order screen, QR, supervisor panel, stage undo, audit trail, audit visibility, audit indicators).

## Следующий шаг
1. Закоммитить fix(auth) — UI часть + API часть (~32 файла).
2. Ручная проверка под CEO (admin@mglass.ru):
   - Owner Center: открываются все справочники (suppliers, brigades, delivery-zones, materials, services).
   - Settings: финансовые настройки, sales-bonuses, sales-scripts, owner-strategy сохраняются.
   - Users: PATCH (изменить роль/пароль), POST telegram_code, invite — все работают.
   - Orders: approve over-discount, изменение статуса.
   - Health Check: fix actions работают.
   - AI Control Center: analyze работает.
3. Регрессия:
   - Менеджер не получает 200 на admin-эндпоинтах (settings PUT, users PATCH).
   - Buyer не получает 200 на suppliers DELETE.
   - CEO получает 403 на /api/admin/sync (git push) — это намеренно.

## Следующий приоритет по SYSTEM.md
Менеджер (`/manager`) или Коммерческий (`/commercial`) — уточнить у пользователя.

## Контекст
- Sales Control: /admin/sales-control — аналитика команды (таблица + drawer)
- API: /api/commercial/stats?period=today|week|month|year
- Drawer: 5 вкладок — Обзор, Без касания, Продажа >3д, Производство >3д, Долгострой
- Детализация сделок только в режиме today (real-time из AmoCRM)

## Открытые вопросы
- AMO_WAZZUP_BOT_USER_ID — нужно уточнить ID Wazzup-бота у Владислава
- AMOCRM_MANAGERS_IDS — возможно нужно добавить/убрать менеджеров
- PWA manifest: добавить на позднем шаге
