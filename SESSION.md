## Текущая задача
Кабинет заказчика B2B — раунд 2: закрыты все 6 пунктов роадмапа (уведомления, документы, КП из просчёта, регламент, логин, аудит паритета).

## Что сделано (эта сессия)
- Аудит паритета прогнан → __tests__/audit/partner-parity.test.ts (0 расхождений)
- Таблица уведомлений → supabase/migrations/20260824_partner_notifications.sql (ПРИМЕНИТЬ владельцу)
- E-mail-слой партнёра (Resend) → lib/notify.ts (sendEmail, notifyPartnerAccessGranted, notifyPartnerOrderStatus)
- Оркестрация bell+email + сверка транзиций → lib/partnerNotify.ts
- API колокольчика → app/api/partner/notifications/route.ts (GET+POST, опортунистич. сверка)
- Пуш по расписанию → app/api/cron/partner-notify/route.ts + vercel.json (0 8-21 * * *)
- Приглашение письмом при выдаче доступа → app/api/admin/b2b-access/route.ts (+ баннер emailed)
- Подтверждение «заявка получена» → app/api/partner/submit/route.ts
- Страница «Уведомления» → app/partner/notifications/page.tsx (+ пункт меню, unread-бейдж)
- Страница «Документы» (КП по заказам) → app/partner/documents/page.tsx (+ пункт меню)
- КП из просчёта + пометка про счёт → app/partner/new/page.tsx
- Регламент + FAQ про счёт/уведомления → app/partner/guide/page.tsx
- Премиальный тёмо-адаптивный логин + лого → app/login/page.tsx

## Следующий шаг
Владельцу применить миграцию 20260824_partner_notifications.sql в Supabase → фича активируется.
Проверить под mrglass: колокольчик, документы, письма (нужен RESEND_API_KEY в проде).

## Контекст
Ветка feat/partner-cabinet-round2 (worktree mglass-b2b-cabinet) от origin/main.
E-mail через Resend — RESEND_API_KEY уже в .env.example; без ключа всё gracefully no-op.
Уведомления дедуп по (client_id, order_id, kind); исторические заказы не выстреливают (окно 45 дней).
Проверки: tsc 0, eslint 0, 342/342 тестов.

## Открытые вопросы
- /admin/b2b-access оставлен в светлой админ-теме (тёмная там бы конфликтовала с остальным /admin) — по согласованию.
- Реальный растровый логотип можно подставить позже; сейчас единый inline-SVG glass-знак.
