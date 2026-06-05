# CHATGPT_PROJECT_BRIDGE.md

> Рабочий протокол: Владислав → ChatGPT → Claude Code → mglass-app production

---

## 1. Назначение файла

Этот файл описывает рабочий протокол между Владиславом, ChatGPT и Claude Code при разработке mglass-app.

**ChatGPT** используется как:
- AI Systems Architect — проектирование архитектуры, выбор подходов
- Product Architect — приоритеты фич, roadmap, scope задач
- QA Analyst — аудит расчётов, проверка логики, план тестирования
- Release Manager — контроль коммитов, версионирование, ветки
- Technical Writer — структура документации, формат отчётов
- Prompt Engineer — разработка промптов для Claude Code

**Claude Code** используется как:
- Исполнитель изменений в коде
- Локальный анализатор файлов и структуры проекта
- Исполнитель TypeScript check (`npx tsc --noEmit`)
- Git assistant (staged файлы, diff, commit, push)
- Автор финальных отчётов после каждой задачи

**Владислав** — единственный, кто подтверждает коммиты и production-действия.

---

## 2. Главные правила безопасности

Всегда соблюдать — без исключений:

```
✗ Не делать git add .
✗ Не делать git commit -a
✗ Не делать force push
✗ Не коммитить без явного подтверждения Владислава
✗ Не менять .env и секреты
✗ Не логировать SUPABASE_SERVICE_ROLE_KEY
✗ Не выполнять SQL без отдельного подтверждения
✗ Не применять миграции автоматически
✗ Не отправлять КП клиенту автоматически
✗ Не писать в AmoCRM без отдельного этапа
✗ Не создавать заказы автоматически
✗ Не подключать Anthropic/OpenAI model call без отдельного approval flow
```

Все AI Proposal outputs всегда остаются draft-only. Hardcoded invariants:

```
approval_required    = true
can_send_to_client   = false
can_write_crm        = false
can_create_order     = false
model_call_executed  = false
```

---

## 3. Стандартный workflow задачи

Каждая задача проходит строго по схеме:

### Шаг 1 — Audit (только чтение)

```
git status --short
Чтение релевантных файлов
Анализ рисков
Финальный отчёт без изменений
```

Claude Code ничего не меняет. Только анализ.

### Шаг 2 — Implementation

```
Минимальные изменения
Только согласованные файлы
npx tsc --noEmit
Финальный отчёт (секции A–H)
Команды для коммита → предложить, не выполнять
```

### Шаг 3 — Code Commit (только после подтверждения Владислава)

```
git add <конкретные файлы>
git diff --cached --name-only   ← проверить, нет ли лишних файлов
git commit -m "..."
git push
```

### Шаг 4 — Production QA

```
Ручной или автоматический тест
Фиксация результата
```

### Шаг 5 — Session Update

```
Обновить SESSION.md
Отдельный chore-коммит SESSION.md — только после QA
```

---

## 4. Правило разделения коммитов

Кодовые изменения и `SESSION.md` **всегда** коммитить отдельно.

```bash
# Кодовый коммит:
git add lib/ai-tools/generateKpDraftTool.ts
git commit -m "fix(ai): align KP draft payload with approval UI schema"
git push

# После production QA — отдельный chore:
git add SESSION.md
git commit -m "chore: update session after KP draft payload QA"
git push
```

---

## 5. Структура финального отчёта Claude Code

### После Implementation (до коммита):

```
A. Что изменено
B. Какие файлы изменены
C. Почему это безопасно
D. Safety confirmation
E. TypeScript check result
F. Ручной или автоматический test-plan
G. Риски
H. Команды для коммита (не выполнять)
```

### После Commit + Push:

```
A. Хэш коммита
B. Файлы в коммите
C. Push выполнен или нет
D. Рабочее дерево чистое или нет
E. Итоговый статус этапа
F. Следующий рекомендуемый шаг
```

---

## 6. Текущий статус проекта

### Mirror proposal block — ЗАКРЫТО (5 июня 2026)

Цепочка коммитов:

| Коммит | Что сделано |
|---|---|
| `2071f94` | AI mirror использует `glass_price_matrix` как источник цены стекла |
| `76dffa4` | margin/waste/tax выровнены с `/calculator/mirror` |
| `bce1224` | Default lighting components включены в cost-расчёт |
| `21db841` | `mirror_light` margin исключён, всегда margin=40 |
| `d2f3177` | SESSION.md закрыт |

Production QA: **9/9 тестов пройдено**

- AI Proposal mirror = `/calculator/mirror` без подсветки: **4 685 ₽**
- AI Proposal mirror = `/calculator/mirror` с подсветкой: **4 052 ₽**
- Safety flags: все подтверждены

---

## 7. Следующий этап

### AI Proposal quality layer

Цель — сделать AI-КП полезным для менеджера:

- Human-readable skeleton text
- Нормальные параметры изделия (тип, толщина, форма, подсветка)
- `draft_payload.items` в формате, который ждёт UI
- Cost breakdown из `costLines`
- Warnings
- Копируемое сообщение без `undefined`
- Подготовка к B2B Quick Quote Skill

---

## 8. Ближайшая задача

### `fix(ai): align KP draft payload with approval UI schema`

**Проблема:**

`generateKpDraftTool.ts` сейчас отдаёт `items` как:
```typescript
{ name: string; description: string; price: number }
```

UI (`app/admin/ai-proposals/[id]/page.tsx`) ждёт:
```typescript
{ line_item: string; dimensions?: string; quantity: number; unit_price: number; total_price: number; note?: string }
```

**Результат несоответствия:**
- Таблица позиций рендерится, но все ячейки пустые / `—`
- `fullDraftText` копирует `undefined × undefined = —`
- `terms.payment_terms` и `terms.warranty` не отображаются

**Что исправить (только `lib/ai-tools/generateKpDraftTool.ts`):**
1. Выровнять тип `KpDraftContent.items` под `DraftItem` UI
2. Исправить `terms`: `payment_terms`, `warranty`, `lead_time_days`
3. Исправить `price_summary`: `currency: 'RUB'`, `vat_included`
4. Продукт всегда в items как первая строка, услуги отдельно

Цена не меняется. Только структура payload.

---

## 9. Что ChatGPT должен получать от Claude Code

После каждой задачи Claude Code возвращает:

```
- git status --short
- Список изменённых файлов
- Diff summary (что именно изменилось)
- TypeScript check result (npx tsc --noEmit)
- Safety confirmation (invariants не нарушены)
- Test-plan (что проверить на production)
- Команды для коммита (не выполнять до подтверждения)
```

После коммита:
```
- Хэш коммита
- Push status (ветка, range)
- Рабочее дерево чистое?
```

---

## 10. Что нельзя делать без отдельного этапа

Следующие действия **всегда требуют отдельного подтверждения** — даже если они кажутся логичным следующим шагом:

| Действие | Причина |
|---|---|
| CRM write | Необратимо, влияет на клиентов |
| Client send | Необратимо, внешняя коммуникация |
| Order creation | Запускает производственный процесс |
| Anthropic/OpenAI model call | Стоимость, безопасность prompt |
| Supabase migrations | Необратимо для schema |
| Production data update | Риск для бизнес-данных |
| Service role exposure | Безопасность |
| Automatic approval | Нарушает approval flow |
| Automatic price change | Влияет на расчёты клиентам, требует QA |

---

## 11. Known limitations (на момент последнего обновления)

- UI не даёт выбирать LED/профиль/БП/рассеиватель вручную — стандартная комплектация
- `draft_payload.items` — таблица пустая из-за schema mismatch (следующая задача)
- `terms.payment_terms` и `terms.warranty` не отображаются (следующая задача)
- `costLines` не прокидываются через quickCalc → quickCalcTool → KpCalcSummary
- Нет редактирования черновика перед approve
- Нет pagination в `/admin/ai-proposals`
- Нет rate limiting на POST `/api/ai/proposals/draft`
- Нет Anthropic binding — генерация детерминированная (`allowModelCall: false`)
- Нет CRM-read integration — клиент заполняется вручную

---

*Последнее обновление: 5 июня 2026*  
*Автор: Claude Code / Владислав*
