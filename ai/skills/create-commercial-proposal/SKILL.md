# Skill: create-commercial-proposal

**Agent:** `proposal-engineer`  
**Status:** Draft-only. No send actions. Requires human approval before delivery.  
**Version:** 1.0 — Foundation stage

---

## A. Purpose

Подготовить структурированный черновик коммерческого предложения (КП) для клиента M-Glass на основе запроса менеджера и данных из существующих калькуляторов.

Skill **не отправляет** КП клиенту. Skill **не обещает** сроки. Skill **не изменяет** цены. Все результаты — черновики на проверку менеджером или Владиславом.

---

## B. Scope — поддерживаемые типы продукции

| Тип | Калькулятор | API |
|---|---|---|
| Зеркало (прямоугольное, овал, круг) | `lib/mirrorCalculator.ts` | `POST /api/calc/quick` |
| Душевая перегородка (swing, sliding, stationary) | `lib/showerCalculator.ts` | `POST /api/calc/quick` |
| Лофт-перегородка | `lib/loftCalculator.ts` | `POST /api/calc/quick` |
| Стекло B2B (раскрой, кромка, закалка) | `lib/b2bCalculator.ts` | `POST /api/calc/quick` |
| Монтажные услуги | `lib/calcServiceCost.ts` | внутренний |
| Доставка | `financial_settings` (Supabase) | внутренний |
| Дополнительные услуги | `services` таблица Supabase | `GET /api/admin/settings` |

Если тип продукта не входит в список — skill возвращает `missing_data` с объяснением и передаёт на ручной расчёт.

---

## C. Inputs

| Поле | Тип | Обязательное | Описание |
|---|---|---|---|
| `client_request` | string | ✅ | Исходный запрос клиента — свободный текст или структурированный |
| `product_type` | `'mirror' \| 'shower' \| 'loft' \| 'b2b' \| 'partition' \| 'other'` | ✅ | Тип изделия |
| `dimensions` | `{ width: number; height: number; depth?: number }` | ✅ для большинства | Размеры в мм |
| `glass_type` | string | — | Тип стекла: прозрачное, матовое, бронза, закалённое и т.д. |
| `hardware_color` | string | — | Цвет фурнитуры: chrome, black, gold, etc. |
| `installation_required` | boolean | — | Нужен ли монтаж |
| `delivery_required` | boolean | — | Нужна ли доставка |
| `address_or_zone` | string | — | Адрес или зона доставки для расчёта стоимости |
| `manager_notes` | string | — | Дополнительные комментарии менеджера |
| `existing_calculation_id` | number | — | ID уже сохранённого расчёта в Supabase — если есть, используется как база |

---

## D. Required Checks — перед запуском расчёта

Skill обязан проверить все пункты. При провале любого — вернуть `missing_data`.

```
[ ] 1. Указан product_type — без него расчёт невозможен
[ ] 2. Указаны dimensions (ширина и высота минимум) — без них нет цены
[ ] 3. Если тип неизвестен ("другое") — передать на ручной расчёт без LLM-оценки
[ ] 4. Если dimensions выходят за технические ограничения — зафиксировать в risk_flags
[ ] 5. Если нужна доставка — есть ли address_or_zone?
[ ] 6. Если нужен монтаж — уточнить тип монтажа (навесной, напольный, в проём)
[ ] 7. Нет ли противоречий (например: душевая stationary без размеров боковых панелей)
[ ] 8. Если existing_calculation_id указан — проверить, что расчёт существует и принадлежит той же сделке
[ ] 9. Цена должна быть получена через калькулятор/API — LLM не имеет права называть цену самостоятельно
[ ] 10. Если данных недостаточно — сформировать список вопросов для менеджера, не придумывать ответы
```

---

## E. Allowed Tools

| Tool | Режим | Назначение |
|---|---|---|
| `quickCalc` | `read_only` | Расчёт стоимости через `lib/quickCalc.ts` или `/api/calc/quick` |
| `generateKpDraft` | `draft` | Создание текста черновика КП через `/api/ai/generate-kp` |
| `readPricingRules` | `read_only` | Чтение `financial_settings`, `pricing_formula`, `discount_limits` |
| `readProductRules` | `read_only` | Чтение ограничений по размерам, типам стекла, совместимости |
| `readProposalTemplates` | `read_only` | Чтение шаблонов оформления КП |
| `getCatalogItems` | `read_only` | Проверка наличия фурнитуры в справочнике |
| `getCalculations` | `read_only` | Чтение существующего расчёта по `existing_calculation_id` |
| `writeAgentLog` | `execute` | Запись лога действий агента в `agent_logs` |

---

## F. Forbidden Actions

Следующие действия **полностью запрещены** для этого skill:

```
❌ Отправлять КП клиенту (email, WhatsApp, Telegram)
❌ Называть цену без расчёта через калькулятор
❌ Применять скидку без проверки discount_limits
❌ Изменять данные в AmoCRM (любой POST/PATCH)
❌ Создавать заказ в производстве
❌ Обещать срок производства или поставки
❌ Записывать готовый расчёт в Supabase без approval менеджера
❌ Изменять формулы в калькуляторах
❌ Изменять pricing_formula или financial_settings
❌ Использовать данные одного клиента для другого
❌ Работать без логирования через writeAgentLog
```

---

## G. Output Format

Skill возвращает структурированный объект. Ни одно поле не является финальным действием.

```typescript
type SkillOutput = {
  // Список недостающих данных для уточнения у менеджера/клиента
  missing_data: Array<{
    field: string
    reason: string
    suggested_question: string
  }>

  // Краткая сводка расчёта
  calculation_summary: {
    product_type:    string
    dimensions:      string
    base_price:      number        // из калькулятора, не из LLM
    installation:    number | null  // null если не нужен
    delivery:        number | null  // null если не нужна
    total_estimate:  number
    margin_ok:       boolean        // из readPricingRules
    calc_source:     string         // 'quickCalc' | 'existing_calculation_id:{N}'
  } | null  // null если данных недостаточно для расчёта

  // Текст черновика КП — только для review, не для отправки
  proposal_draft: string | null

  // Короткое сообщение менеджеру: что сделано, что не хватает, что проверить
  manager_message: string

  // Всегда true на этом этапе — ни один КП не уходит без approval
  approval_required: true

  // Список флагов риска
  risk_flags: Array<{
    level:       'info' | 'warning' | 'critical'
    description: string
  }>
}
```

---

## H. Quality Checklist

Перед финализацией черновика агент обязан проверить:

```
[ ] КП конкретное: есть размеры, тип изделия, тип стекла (или явное "уточнить")
[ ] Цена имеет источник: поле calc_source заполнено
[ ] Без лишнего текста: нет рекламных клише, не упоминаются несуществующие акции
[ ] Сроки не обещаются: нет фраз "готово через X дней" без подтверждения от производства
[ ] Монтаж/доставка явно указаны: если включены — сумма, если нет — явная пометка "без монтажа"
[ ] missing_data заполнен: если данных не хватало — список вопросов для менеджера присутствует
[ ] risk_flags заполнены: все нестандартные размеры, редкие материалы, неясные требования отмечены
[ ] approval_required: true — всегда
[ ] Лог записан через writeAgentLog
```

---

## I. Example Flow

```
1. Менеджер передаёт: "клиент хочет душевую 900×2000, стекло прозрачное, чёрная фурнитура, с монтажом"
                        ↓
2. Skill проверяет missing_data:
   - product_type: shower ✅
   - dimensions: 900×2000 ✅
   - hardware_color: black ✅
   - installation_required: true ✅
   - delivery_required: не указано → добавить в missing_data
   - address_or_zone: не указано → добавить в missing_data
                        ↓
3. quickCalc → { shower, swing, 900×2000, black, withMounting: true }
   → base_price: 47 500 ₽, installation: 8 000 ₽
                        ↓
4. readPricingRules → margin_ok: true
                        ↓
5. generateKpDraft → текст черновика КП
                        ↓
6. writeAgentLog → записать событие
                        ↓
7. Вернуть SkillOutput:
   - missing_data: [{ field: 'delivery', question: 'Нужна ли доставка? Если да — адрес?' }]
   - calculation_summary: { total_estimate: 55 500, margin_ok: true, calc_source: 'quickCalc' }
   - proposal_draft: "..."
   - manager_message: "Черновик готов. Уточните доставку."
   - approval_required: true
   - risk_flags: []
                        ↓
8. Менеджер проверяет → уточняет доставку → approves → отправляет клиенту сам
```

---

## J. Not in Scope (намеренно не реализовано на этапе 1)

- Автоматическая отправка КП — требует отдельного approval UI
- Сохранение черновика в Supabase — требует `agent_action_log` таблицу
- Расчёт сложных изделий (нестандартные углы, арки) — только ручной расчёт
- B2B-расчёт с оптовыми скидками — требует отдельного flow
- Подбор альтернативной фурнитуры — требует `check-catalog-item` skill
