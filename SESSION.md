## Текущая задача
Production App Steps 3-5 завершены — роли, главный экран и экран заказа работают с реальными данными

## Что сделано (эта сессия)
- Step 3 — роли и доступ:
  - lib/getRole.ts → убран /b2b-orders из роли production
  - middleware.ts → production-пользователь с / редиректится на /production-app
- Step 4 — главный экран:
  - app/production-app/page.tsx → server component, загружает b2b_orders, считает 4 счётчика, список заказов по дедлайну
- Step 5 — экран заказа:
  - app/production-app/orders/[id]/page.tsx → полный client component (порт из /p/o/{id}), список деталей, групповые действия, запись в notes.detail_stages

## Следующий шаг
Step 6 из плана:
Интеграция с QR /p/o/{id} — убедиться что оба интерфейса пишут в одну структуру, не конфликтуют
(Скорее всего оба уже используют notes.detail_stages с одинаковым форматом — нужно только проверить)

## Контекст
- Production App пишет в notes.detail_stages — тот же формат что и /p/o/{id}
- Главный экран: server component (no 'use client'), загружает данные серверно
- Фильтрация активных заказов: .not('notes', 'ilike', '%"status":"quote"%') + .is('archived_at', null)
- Отгруженные (stages.shipped) исключаются из показа на главном экране
- Счётчики: Активных / Просрочено / Проблемы / Упаковано
- Сортировка: overdue → today → tomorrow → normal → ready → shipped

## Открытые вопросы
- Step 6: /p/o/{id} имеет back link к /b2b-orders — нужно ли добавить альтернативу для production-app?
- Step 7 (Проблемы): нужна отдельная страница фиксации проблем с выбором причины из списка
- Step 8 (Панель начальника): отдельный view для admin/ceo с агрегацией по всем заказам
- PWA manifest: добавить на шаге 10
