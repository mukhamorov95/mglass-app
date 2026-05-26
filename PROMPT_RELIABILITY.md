# ПРОМПТ: Reliability — Защита системы от поломок

> Скопируй всё ниже и отправь Claude как первое сообщение новой сессии.

---

## Контекст проекта

MGlass — CRM + калькулятор для производства зеркал, лофт-перегородок и душевых. Next.js + Supabase.
Прочитай `SESSION.md` и `MGLASS_SYSTEM_RULES.md` перед тем как что-то делать.

---

## Что уже внедрено (не переделывай)

- `lib/env.ts` — валидация ENV-переменных при старте сервера ✅
- `__tests__/calculators/` — юнит-тесты для mirror/loft/shower калькуляторов (Vitest) ✅
- `assertPayloadIntegrity()` в `lib/saveCalculation.ts` ✅
- Таблицы `ai_recommendations` и `health_fix_log` в Supabase ✅
- AI Control Center читает/пишет рекомендации из БД (не localStorage) ✅
- Health Check пишет лог исправлений в БД (не localStorage) ✅

---

## Три направления для дальнейшего развития

### 1. Расширить тесты калькуляторов
Файлы: `__tests__/calculators/mirror.test.ts`, `loft.test.ts`, `shower.test.ts`

Добавить:
- Тесты граничных случаев: нулевые размеры, максимальная скидка 100%, отсутствующий материал
- Тест инварианта: `final_price === grandTotal` (INV-1 из MGLASS_SYSTEM_RULES.md)
- Тест: `profit` не включает стоимость услуг (INV-4)
- Тест регрессии: при изменении цен в матрице, старые расчёты не меняются

### 2. Расширить ENV-валидацию
Файл: `lib/env.ts`

Добавить проверку:
- `CRON_SECRET` — без него cron-задачи возвращают 401 молча
- `TELEGRAM_BOT_TOKEN` — без него Telegram-бот не работает
- Soft-warn (console.warn) для опциональных ключей, hard-throw для критичных

### 3. RLS в Supabase (Row Level Security)
Сейчас роли только на уровне приложения. Добавить RLS-политики для таблиц:
- `calculations` — менеджер видит только свои
- `orders` — менеджер видит только свои
- `users` — каждый видит только себя, admin видит всех

SQL для Supabase Dashboard (не делай это в коде — только через Dashboard).

---

## Как работать с этим промптом

1. Прочитай `SESSION.md`
2. Запусти тесты: `npx vitest run` — убедись что всё зелёное
3. Выбери одно из трёх направлений выше
4. Работай в рамках конкретного Skill-файла из `skills/`

---

*Хранится в `PROMPT_RELIABILITY.md`. Обновляй при добавлении новых защитных механизмов.*
