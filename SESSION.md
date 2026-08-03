## Текущая задача
Заявки с сайта → CRM. ВАЖНО: сайт = mglass-web (~/SEO MGLASS APP/mglass-web, Next.js, деплой vercel CLI,
НЕ git, НЕ Tilda). Он УЖЕ пишет заявки напрямую в ту же Supabase → crm_leads source='site' (app/api/lead/route.ts).
Добавил в сайте назначение на владельца (manager=LEAD_OWNER||'Администратор'). Лишний CRM-эндпоинт /api/site/lead удалён (сайт им не пользовался).
mglass.pro на Tilda — ОТДЕЛЬНОЕ/неактуальное, не путать.

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

## Новое: автономный диспетчер бота, Фаза A (ветка feature/avito-autonomous-dispatcher, PR — на ревью)
Бот ведёт заявку сам по левой стороне (зона «Квалификация») до «Закрыт на замер», потом человек.
- lib/avito/flags.ts: +measure_agreed, address_known, object_ready, stall.
- lib/avito/scoreLead.ts: +measureClosed (согласие+телефон+адрес+готовность).
- lib/avito/dispatcher.ts (новый): decideNextAction → disqualify/close_measure/park/collect (чистая, тесты).
- avitoManagerRuntime: персона — дожим на замер (2500₽ в зачёт заказа), брать окно+адрес+готовность.
- webhook: бот работает ТОЛЬКО зону «Квалификация»; close_measure→этап «Замер назначен»+задача kind=measure+Telegram; park→«Долгострой»; disqualify→lost.
- Решения владельца: замер 2500₽ в зачёт; «закрыт»=согласие+телефон+адрес+готовность; дату финализирует менеджер.
- 268/268 тестов, tsc/lint чисто.
Фаза B (готово): бот при stall заполняет follow_up (in_days+note) → webhook ставит crm_task с датой (лид «Долгострой») → крон avito-followup будит бота по созревшим задачам-себе с контекстом.
Фаза C (готово): кнопка «Сделать заявку на замер для замерщика» в карточке (этап «Замер назначен») → создаёт заявку в СУЩЕСТВУЮЩЕЙ measure_requests (не дубль!) + колонка lead_id (миграция 20260803_measure_requests_lead_link.sql) → пул замерщиков /measurer-cabinet.
ВСЁ A+B+C в PR #130 (не мёржено). Перед деплоем применить 20260803_measure_requests_lead_link.sql. 268/268, build ✓.
ДАЛЬШЕ: D мультиканал (Wazzup/Telegram → тот же движок).

## Разбор сделок AmoCRM → уроки боту (PR #129, смёржен 741e363)
Проанализированы 216 сделок «Продажи» за 90д (129 выигранных, read-only). Amo хранит только
входящие сообщения клиентов + внутренние заметки менеджеров (исходящие реплики недоступны).
Находки: срыв замеров из-за неготовности объекта (117), дожим «отложенных» по триггеру,
приоритет B2B/дизайнерам, скорость ответа. Внесены в персону avitoManagerRuntime (секция
«УРОКИ ИЗ РЕАЛЬНЫХ СДЕЛОК»). Отчёт: AVITO AI/05_РАЗБОР_СДЕЛОК_AMO.md. PR #129 на ревью (не мёрджен).
Скрипты разбора — в scratchpad (PII-выгрузки удалены после анализа).

## Приём заявок с сайта — РЕАЛЬНАЯ картина
Сайт mglass-web (~/SEO MGLASS APP/mglass-web) уже пишет заявки в общую Supabase → crm_leads
source='site' через свой app/api/lead/route.ts (Telegram, honeypot 'company', UTM, инференс продукта, heat).
Правка: добавлено manager=LEAD_OWNER||'Администратор' (владелец обрабатывает первым; сейчас в CRM только он).
Лишний CRM-эндпоинт /api/site/lead и его строка в middleware УДАЛЕНЫ (PR #133/#134 были из ошибочного Tilda-пути).
Деплой сайта — vercel --prod из папки сайта (CLI авторизован mukhamorov95-1222).
Опционально: миграция landing_page/utm в crm_leads (у сайта есть фолбэк, если колонок нет).

## Статус: ЗАДЕПЛОЕНО В ПРОД
PR #122 смёрджен в main (squash, коммит 0a73e3b), Vercel Production deploy = success.
Миграции в проде. Всё Авито-направление (Фазы 1–3 + вариант A) живо на mglass-app.vercel.app.
Смотреть: /crm (доска, фильтр готовности), /crm/[id] (блок «Готовность заявки» + 🧮 Посчитать),
/crm/import, /crm/bot-test. Корпус: Supabase Table Editor → ai_manager_examples.

## Следующий шаг
1. Проверить в проде: менеджер отвечает клиенту через /crm/[id] → строка в ai_manager_examples → бот подмешивает пример.
2. У существующих лидов флажки пусты (heat=cold, 0%) — оживут с первым новым сообщением клиента (webhook пересчитает).
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
