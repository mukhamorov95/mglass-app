## Текущая задача
Production App Step 2 завершён — каркас создан, ждём подтверждения для commit

## Что сделано (эта сессия)
- can_view_all_clients toggle → supabase/migrations/20260615_add_can_view_all_clients_to_users.sql, app/api/admin/users/route.ts, app/admin/users/page.tsx, app/calculator/b2b/page.tsx
- Loading Safety Stage 1 → app/b2b-quotes/page.tsx, app/b2b-orders/page.tsx
- Loading Safety Stage 2 → app/admin/glass-prices/page.tsx
- Production App архитектурный документ → ai/docs/PRODUCTION_APP_PLAN.md
- Production App skeleton (Step 2/10):
  - lib/getRole.ts → /production-app добавлен в manager, production, ceo
  - components/Sidebar.tsx → /production-app добавлен в PRODUCTION_ITEMS, MANAGER_B2B, CEO_OWNER, ADMIN_OWNER
  - app/production-app/layout.tsx → создан (role check: admin|ceo|manager|production)
  - app/production-app/page.tsx → создан (4 stat cards + demo link)
  - app/production-app/orders/[id]/page.tsx → создан (5 stage checkboxes skeleton)

## Следующий шаг
После commit Step 2 → Step 3 из плана:
Подключить реальные данные: загрузить b2b_orders со статусами detail_stages, показать список заказов на главной странице

## Контекст
- Commit message для Step 2: feat(production-app): add mobile app skeleton
- tsc --noEmit чист (только pre-existing ошибки в __tests__/calculators/mirror.test.ts)
- Production App — мобильный PWA для производственных рабочих
- Маршруты: /production-app (главная), /production-app/orders/[id] (детали заказа)
- Этапы: Резка / Полировка / Сверловка / Вырезы / Упаковка
- Роли с доступом: admin, ceo, manager, production

## Открытые вопросы
- Step 3: откуда брать данные о заказах — b2b_orders.notes.detail_stages или notes.stages?
- PWA manifest / service worker — нужен ли уже на Step 3 или позже?
- Нужна ли отдельная мобильная навигация (bottom bar) или sidebar достаточен?
