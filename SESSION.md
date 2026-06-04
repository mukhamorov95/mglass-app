## Текущая задача
Mirror matrix QA пройден. Следующий шаг — micro-audit расхождения цен 4 685 ₽ vs 5 016 ₽ или аудит skeleton-текста и lighting компонентов.

## Что сделано (сессия 4 июня 2026)

### Архитектурный аудит mirror — ЗАКРЫТО
- Найдено расхождение: quickCalc использовал public.materials, /calculator/mirror — glass_price_matrix
- Задокументировано 3 варианта (A/B/C), выбран вариант B (rewrite mirror-ветки)

### fix(ai): mirror proposals use glass price matrix — ЗАКРЫТО (коммит `2071f94`)

Что изменено архитектурно:
- **Раньше:** AI mirror брал цену из `public.materials.sale_price / cost_price`
- **Теперь:** AI mirror берёт цену из `glass_price_matrix` через `getMatrixPrice()` — тот же источник, что `/calculator/mirror`
- Fallback на `public.materials` сохранён как safety fallback с explicit warning
- `/calculator/mirror` и AI Proposal mirror теперь используют один мастер-источник цены

Файлы коммита:
- `lib/quickCalc.ts` — `loadAll()` добавил `glass_price_matrix`, mirror-ветка переписана
- `lib/ai-tools/quickCalcTool.ts` — propagation `raw.warnings`
- `lib/ai-tools/generateKpDraftTool.ts` — добавлено поле `options?`, label mirror зависит от `hasLighting`
- `lib/ai-tools/createCommercialProposalRuntime.ts` — передаёт `options` в `runGenerateKpDraftTool`
- `app/admin/ai-proposals/page.tsx` — mirror-specific поля в форме (mirrorType, thicknessMm, hasLighting, shape)

### Production QA mirror matrix — ЗАКРЫТО (4 июня 2026)

| # | Тест | Параметры | Результат | Статус |
|---|---|---|---|---|
| 1 | Baseline /calculator/mirror | Осветлённое, 4 мм, 800×600, без подсветки | 4 685 ₽ | ✅ |
| 2 | AI Proposal id=7 | Осветлённое, 4 мм, 800×600, без подсветки | 5 016 ₽ | ✅ работает |
| 3 | Title без подсветки | hasLighting: false | Нет "с подсветкой" в заголовке | ✅ |
| 4 | Safety flags | id=7, detail page | approval_required=true, can_send=false, can_write_crm=false, can_create_order=false, model_call=false | ✅ |
| 5 | Безопасность | — | CRM не трогалась, клиенту не отправлялось, заказ не создавался, Anthropic/OpenAI не вызывались | ✅ |

**Вывод:** AI Proposal mirror больше не падает. Архитектурная проблема источника цены закрыта.

Разница 5 016 ₽ vs 4 685 ₽ (~331 ₽ / ~7%) — техническое расхождение, требует отдельного micro-audit (rounding, options, состав позиций).

## Следующий шаг

**Вариант A — Mirror pricing parity micro-audit (рекомендуется):**
1. Сравнить состав cost lines в AI Proposal (draft_payload) с cost lines в /calculator/mirror
2. Найти источник расхождения 331 ₽ (rounding, waste_pct, комплектующие, сборка)
3. Проверить, передаются ли mirrorWastePct / shapeModifierPct в quickCalc mirror-ветку
4. При необходимости — добавить загрузку waste модификаторов в loadAll()

**Вариант B — Skeleton text + lighting components audit:**
1. Проверить, какие lighting компоненты входят в AI-расчёт при hasLighting=true
2. Улучшить текст черновика КП: читаемые формулировки вместо технических boolean
3. Добавить отображение состава позиций в draft_payload.items

## Контекст

- Весь код закоммичен на production (Vercel), коммит `2071f94`
- `getMatrixPrice` — pure function из `lib/glassMatrix.ts`, вызывается без browser client
- `loadGlassMatrix()` (browser) не вызывается в quickCalc.ts — запрос идёт через server-side `db()`
- Shower и loft ветки не тронуты
- Supabase schema не менялась
- `SESSION.md` — единственный незакоммиченный файл

## Текущие ограничения (known limitations)

- Разница цены ~7% между `/calculator/mirror` и AI Proposal — требует micro-audit rounding/options
- Lighting компоненты (LED, профиль, БП, рассеиватель) не загружаются в quickCalc — используются только если передан материал из `materials`
- Skeleton-текст черновика требует улучшения: boolean-поля не форматированы как текст
- Нет редактирования черновика перед approve
- Нет pagination в списке `/admin/ai-proposals`
- Нет rate limiting на POST `/api/ai/proposals/draft`
- RLS на `shower_catalog_items` не настроена явно

## Открытые вопросы

- Источник расхождения 4 685 ₽ vs 5 016 ₽: rounding? waste_pct? комплектующие зеркала / сборка?
- `ai/skills/`, `ai/workflows/`, `ai/memory/` — директории не созданы, запланированы для будущих этапов
- Нет Anthropic binding — генерация детерминированная (`allowModelCall: false`)
- Нет CRM-read integration — клиент заполняется вручную
