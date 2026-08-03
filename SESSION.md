## Текущая задача
Система флажков + обучение бота (Авито) — Фазы 1+2+3 готовы, PR #122 (ветка feature/avito-lead-flags).

## Фаза 3 (обучение бота) — сделано
- supabase/migrations/20260803_ai_manager_examples.sql — корпус «клиент → ответ менеджера» (RLS server-only)
- lib/avito/managerExamples.ts — rankExamples (чистая, 5 тестов) + getRelevantExamples (fail-open)
- avitoManagerRuntime — 3-й параметр opts.examples, few-shot в system-промпт (не копировать цены)
- webhook — getRelevantExamples(product, текст) → передаёт боту
- scripts/mine-manager-replies.mjs — майнит пары из crm_lead_events в ai_manager_examples (идемпотентно по hash; --dry для превью). ЗАПУСТИТЬ после применения миграции: node scripts/mine-manager-replies.mjs

## Что сделано (эта сессия)
- lib/avito/flags.ts (новый) → единый каталог флагов (ядро/усиливающие/инфо/дисквалиф.), веса, порядок сбора ASK_ORDER. Добавлены флаги object_type и repeat_referral, усилен вес photo (3).
- lib/avito/scoreLead.ts (новый) → детерминированный скоринг: флаги → readiness(0–100) → heat(cold/warm/hot) → missingNext. Правило 🟢: всё ядро ИЛИ (ready_measure+contact).
- __tests__/ai/scoreLead.test.ts (новый) → 8 тестов, все зелёные.
- supabase/migrations/20260803_crm_lead_flags.sql (новый) → crm_leads += flags jsonb, readiness int, heat text(check), missing_next text; индекс по heat.
- lib/ai-tools/avitoManagerRuntime.ts → tool respond отдаёт flags{}; ManagerTurn.flags; секция «ФЛАЖКИ ГОТОВНОСТИ» в персоне (собирать по одному в порядке приоритета); price_quoted/contact проставляются детерминированно.
- app/api/avito/webhook/route.ts → OR-мёрдж флагов, scoreLead, запись flags/readiness/heat/missing_next; при becameHot — событие + автозадача crm_tasks «Перезвонить»; событие на каждый новый флаг; Telegram обогащён (готовность, ядро, список флагов, новый заголовок 🔥).
- app/crm/[id]/page.tsx → блок «Готовность заявки» (чеклист флагов + прогресс-бар + светофор + «бот запрашивает …» + дисквалификация).
- Проверки: vitest 251/251 ✓, tsc по изменённым файлам чисто, eslint по изменённым — 0 ошибок (1 предсущ. warning RUB).

## Статус БД (прод, применено владельцем через SQL Editor)
- Обе миграции 20260803_* применены в прод (проверено: flags/readiness/heat/missing_next есть, ai_manager_examples есть).
- Майнинг запущен: пар «клиент→менеджер» 0 (в истории 22 КЛИЕНТ + 12 БОТ, 0 МЕНЕДЖЕР) — корпус пуст, т.к. менеджеры ещё не перехватывали чаты через CRM. Скрипт корректен; корпус наполнится, когда появятся ответы менеджеров.

## Фаза 3, вариант A (живое обучение) — СДЕЛАНО
- app/api/avito/thread POST: при перехвате менеджером пара «контекст клиента → ответ» сразу пишется в ai_manager_examples (fail-open).
- lib/avito/managerExamples.ts: clientContextFromHistory / isUsefulReply / exampleHash (единый хеш со скриптом) / saveManagerExample.
- Обучение теперь идёт само: менеджер пишет через CRM → пример сохраняется → webhook подмешивает боту. vitest 261/261.

## Следующий шаг
1. Смёрджить PR #122, задеплоить (миграции уже в проде). Всё Авито-направление (Фазы 1–3 + вариант A) в PR #122.
2. Проверить в проде: менеджер отвечает клиенту через /crm/[id] → в ai_manager_examples появляется строка → бот в следующем диалоге подмешивает пример.
3. Открытый вопрос: авто-распределитель 🟢-заявок (round-robin) — пока НЕ делаем, общий пул.
4. Не начато: разбор расхождений бот↔менеджер → правила персоны (Фаза 3, шаг 3).

## Примечание по доступу
Supabase MCP прописан в КЛАУД/.mcp.json (токен открытым текстом — стоит вынести в env). Прямой DDL через Management API блокируется авто-классификатором; миграции применяет владелец в SQL Editor или через MCP при запуске из mglass-app.

## Контекст
Хаб компетенции по Авито: ~/Desktop/КЛАУД/mglass-app <-> /Users/mukhamorov01/AVITO AI (доки 01–04 + ROADMAP).
Дизайн флажков: AVITO AI/03_СИСТЕМА_ФЛАЖКОВ.md. Решения владельца: порог 🟢 = ядро ИЛИ замер+телефон; набор флагов + object_type + repeat_referral + усиленный photo.
Изменения НЕ закоммичены (владелец не просил commit). Ветка feature/avito-lead-flags от main.

## Открытые вопросы
- Автоназначение на конкретного менеджера при 🟢 пока не делаем (нет round-robin) — задача уходит в общий пул, менеджеры видят по RLS. Обсудить, нужен ли авто-распределитель.
- bot-test (/crm/bot-test) пока не показывает флаги в UI (данные уже приходят в turn.flags) — добавить в Фазе 2.
