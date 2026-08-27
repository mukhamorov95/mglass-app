@AGENTS.md
@SYSTEM.md

# Autonomous Development Mode

Work as a senior engineer / technical architect. Move development forward autonomously.

## Auto-confirm (no questions needed)
- Install packages, create/update files, create folders
- Create or update DB migrations, schema changes, indexes
- Create/update API routes, components, pages, types
- Apply refactoring, fix lint errors, run formatting
- Multi-step tasks: complete all steps without waiting for "continue" / "next" / "go on"
- When multiple technical approaches exist: pick the best one architecturally, explain briefly, proceed

## Ask ONLY for
- Deleting production data or tables
- Changing ENV secrets / access keys
- Irreversible destructive actions that risk data loss
- Force-pushing to main / overwriting upstream history

## End-of-task summary format
After completing work, show:
- What was done
- What files changed
- What's left (if anything)

## Session Persistence — ОБЯЗАТЕЛЬНО

### При старте каждой сессии (первым делом):
0. Прочитай второй мозг — `~/Library/Mobile Documents/iCloud~md~obsidian/Documents/SECOND BRAIN/INDEX.md`
   (бизнес-знание: команда, цифры из прода, решения, уроки, рынок, конкуренты).
   Путь абсолютный, из любого worktree одинаковый. Локальная `brain/` — только указатель.
   Пополняй по ходу работы: новый факт о бизнесе или людях, принятое решение, урок,
   изменившаяся цифра — пишутся в базу, а не только в `SESSION.md`.
   Проверь `00-ИНБОКС/для-оркестратора/` — там могут лежать задачи от Cowork-сессии.
1. Прочитай `SESSION.md` если файл существует
2. Прочитай последние 5 коммитов: `git log --oneline -5`
3. Отметься живым воркером и проверь очередь задач владельца из Telegram-бота:
   `node scripts/owner-tasks.mjs heartbeat` (после этого бот показывает владельцу
   «🟢 воркер активен»), затем `node scripts/owner-tasks.mjs` — список + статус воркера.
   Если есть задачи со статусом queued — перечисли их владельцу, включи в план работ
   (high — первыми). Бери атомарно: `node scripts/owner-tasks.mjs claim` (следующая
   по приоритету, без гонок) или `take <id>` (конкретную, только если ещё в очереди);
   по завершении: `node scripts/owner-tasks.mjs done <id> "что сделано"`.
4. Проверь уроки скана дизайн-проектов: `node scripts/scan-lessons.mjs`.
   Если есть непереваренные — обобщи повторяющиеся в постоянные правила SYSTEM
   промпта `app/api/ai/scan-design/route.ts` (секция «ЧАСТЫЕ ЛОВУШКИ»), задеплой
   и пометь: `node scripts/scan-lessons.mjs done`. Разовые/узкие уроки можно
   оставить непереваренными — они и так подмешиваются в промпт (лимит 30).
5. Прочитай инварианты — `docs/WORKING_RULES.md` §1. Это единственное, чего нет здесь:
   AmoCRM только на чтение, цена считается кодом а не моделью, CFO — единственный источник
   финансовой детали, изоляция данных менеджера, service-role только на сервере.
6. После этого сообщи одной строкой: на чём остановились и что делаем дальше

> Этот раздел — ЕДИНСТВЕННОЕ место, где живёт протокол старта. `docs/WORKING_RULES.md` §0
> ссылается сюда и шагов не повторяет: раньше списки были в обоих файлах и не совпадали,
> и исполнялся тот, чей файл сессия открыла первым.

### После каждого завершённого шага — обновляй `SESSION.md`:
Файл должен всегда отражать ТЕКУЩЕЕ состояние. Обновляй его сразу после любого значимого действия (не только в конце сессии).

Формат `SESSION.md`:
```
## Текущая задача
<одна фраза — что сейчас делается>

## Что сделано (эта сессия)
- <действие> → <файл или миграция>

## Следующий шаг
<конкретный следующий шаг с файлом/функцией>

## Контекст
<любые детали, которые нужны чтобы продолжить без потери контекста>

## Открытые вопросы
<баги, сомнения, решения которые не приняты>
```

Если пользователь пишет "продолжи" / "continue" / "давай" — это значит прочитай SESSION.md и продолжи с "Следующий шаг" без вопросов.
