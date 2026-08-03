## Текущая задача
Система флажков квалификации заявок Авито — Фазы 1+2 готовы, PR #122 (ветка feature/avito-lead-flags).

## Что сделано (эта сессия)
- lib/avito/flags.ts (новый) → единый каталог флагов (ядро/усиливающие/инфо/дисквалиф.), веса, порядок сбора ASK_ORDER. Добавлены флаги object_type и repeat_referral, усилен вес photo (3).
- lib/avito/scoreLead.ts (новый) → детерминированный скоринг: флаги → readiness(0–100) → heat(cold/warm/hot) → missingNext. Правило 🟢: всё ядро ИЛИ (ready_measure+contact).
- __tests__/ai/scoreLead.test.ts (новый) → 8 тестов, все зелёные.
- supabase/migrations/20260803_crm_lead_flags.sql (новый) → crm_leads += flags jsonb, readiness int, heat text(check), missing_next text; индекс по heat.
- lib/ai-tools/avitoManagerRuntime.ts → tool respond отдаёт flags{}; ManagerTurn.flags; секция «ФЛАЖКИ ГОТОВНОСТИ» в персоне (собирать по одному в порядке приоритета); price_quoted/contact проставляются детерминированно.
- app/api/avito/webhook/route.ts → OR-мёрдж флагов, scoreLead, запись flags/readiness/heat/missing_next; при becameHot — событие + автозадача crm_tasks «Перезвонить»; событие на каждый новый флаг; Telegram обогащён (готовность, ядро, список флагов, новый заголовок 🔥).
- app/crm/[id]/page.tsx → блок «Готовность заявки» (чеклист флагов + прогресс-бар + светофор + «бот запрашивает …» + дисквалификация).
- Проверки: vitest 251/251 ✓, tsc по изменённым файлам чисто, eslint по изменённым — 0 ошибок (1 предсущ. warning RUB).

## Следующий шаг
1. ⚠️ Применить миграцию 20260803_crm_lead_flags.sql в Supabase ДО деплоя PR #122 (webhook/импорт пишут flags/readiness/heat/missing_next).
2. Смёрджить PR #122, задеплоить, проверить: бот собирает флаги → карточка «Готовность заявки» + светофор → при сборе ядра лид 🟢 + автозадача + Telegram; доска фильтрует по готовности; кнопка «Посчитать» в карточке.
3. Фаза 3: обучение бота на ответах менеджеров (scripts/mine-manager-replies.mjs + ai_manager_examples + few-shot). См. AVITO AI/04_ОБУЧЕНИЕ_БОТА.md.
4. Открытый вопрос владельцу: нужен ли авто-распределитель 🟢-заявок по менеджерам (round-robin) или общий пул.

## Контекст
Хаб компетенции по Авито: ~/Desktop/КЛАУД/mglass-app <-> /Users/mukhamorov01/AVITO AI (доки 01–04 + ROADMAP).
Дизайн флажков: AVITO AI/03_СИСТЕМА_ФЛАЖКОВ.md. Решения владельца: порог 🟢 = ядро ИЛИ замер+телефон; набор флагов + object_type + repeat_referral + усиленный photo.
Изменения НЕ закоммичены (владелец не просил commit). Ветка feature/avito-lead-flags от main.

## Открытые вопросы
- Автоназначение на конкретного менеджера при 🟢 пока не делаем (нет round-robin) — задача уходит в общий пул, менеджеры видят по RLS. Обсудить, нужен ли авто-распределитель.
- bot-test (/crm/bot-test) пока не показывает флаги в UI (данные уже приходят в turn.flags) — добавить в Фазе 2.
