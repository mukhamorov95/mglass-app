## Текущая задача
Система AI-агентов полностью собрана — все 4 агента готовы к активации

## Что сделано (сессия 14 мая 2026 — AI агенты)
- `lib/agentMemory.ts` — общий паттерн памяти для всех агентов (readMemory/writeMemory/writeLog/startRun/finishRun/failRun)
- `app/admin/agents/page.tsx` — дашборд: грид 2×2, тоггл вкл/выкл, ручной запуск, лента логов, автообновление 30с
- `app/api/cron/agent-revenue/route.ts` — переписан с памятью (followup WhatsApp клиентам)
- `app/api/cron/agent-analyst/route.ts` — переписан с памятью (6ч отчёт метрик)
- `app/api/cron/agent-production/route.ts` — создан (Максим, мониторинг производства 🏭)
- `app/api/cron/agent-catalog/route.ts` — создан (Наполнитель справочников 🧠)
- `app/api/agents/run/[key]/route.ts` — прокси для ручного запуска (проверяет Supabase-сессию)
- `supabase/migrations/20250514_agent_settings_v2.sql` — columns memory, config, is_running, total_runs
- Sidebar.tsx — пункт AI-агенты в SEO и ADMIN вкладках

## Предыдущее (14 мая 2026 — зеркала)
- `supabase/migrations/20250514_mirror_lighting_components.sql` ✅ ПРИМЕНЕНА + RLS политики
- `app/admin/mirror-lighting/page.tsx` — справочник компонентов (CRUD)
- `lib/mirrorCalculator.ts`, `app/calculator/mirror/page.tsx` — модульный конфигуратор

## Следующий шаг
Применить в Supabase SQL Editor:
1. `ALTER TABLE calculations ADD COLUMN IF NOT EXISTS followup_sent_at TIMESTAMPTZ;`
2. Содержимое `supabase/migrations/20250514_agent_settings.sql`
3. Содержимое `supabase/migrations/20250514_agent_settings_v2.sql`
4. `supabase/migrations/20250514_service_cost_price.sql` (себестоимость доп. услуг)

После — включить агентов через /admin/agents и добавить в vercel.json когда готов

## Контекст
- Агенты НЕ добавлены в vercel.json — автозапуска нет, только ручной через дашборд
- Прокси /api/agents/run/[key] требует Supabase сессию (аутентифицированный пользователь)
- agent-catalog: require_approval=true — только предлагает позиции, не добавляет сам
- Нужны env-переменные: CRON_SECRET, ANTHROPIC_API_KEY, WAZZUP_API_KEY, WAZZUP_CHANNEL_ID, NEXT_PUBLIC_APP_URL
- Cookie user-role кэшируется 1ч; шрифты PT Sans в public/fonts/ — не удалять (PDF)

## Открытые вопросы
- Миграции agent_settings + agent_settings_v2 применены в Supabase? (нужно проверить)
- Колонка followup_sent_at добавлена в calculations?
- Переменная NEXT_PUBLIC_APP_URL задана в Vercel?
- Миграция 20250514_service_cost_price.sql — ещё не применена
