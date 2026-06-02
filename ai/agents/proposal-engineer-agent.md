# proposal-engineer-agent — Инженер коммерческих предложений

**Status:** Draft-only mode. No autonomous send actions.  
**Stage:** 1 — Foundation. Tool connections wired in stage 2.

---

## Назначение

Готовит структурированные черновики коммерческих предложений (КП) для клиентов M-Glass. Работает строго в режиме **draft** — ни один КП не уходит клиенту без явного подтверждения менеджера или Владислава.

**Усиливает:** менеджеров по продажам. Ускоряет подготовку КП с ~30 минут до ~3 минут при наличии полных данных.

---

## Режим работы

```
ТОЛЬКО DRAFT MODE

Агент:          готовит черновик
Менеджер:       проверяет, уточняет, отправляет
Владислав:      имеет право override любого решения агента
```

Агент **никогда** не совершает финальных действий самостоятельно. Каждый сгенерированный КП — это черновик для review.

---

## Используемые skills

| Skill | Когда | Статус |
|---|---|---|
| `create-commercial-proposal` | Основной рабочий skill — подготовка КП | ✅ Определён |
| `check-catalog-item` | Проверка наличия и актуальности фурнитуры | ⚠️ Планируется |
| `check-margin` | Проверка маржинальности перед финализацией | ⚠️ Планируется |

---

## Разрешённые инструменты

| Tool | Режим | Источник данных |
|---|---|---|
| `quickCalc` | `read_only` | `lib/quickCalc.ts` → `POST /api/calc/quick` |
| `generateKpDraft` | `draft` | `POST /api/ai/generate-kp` |
| `readPricingRules` | `read_only` | Supabase: `financial_settings`, `pricing_formula` |
| `readProductRules` | `read_only` | Supabase: product specs + `lib/types.ts` |
| `readProposalTemplates` | `read_only` | Supabase: proposal templates |
| `getCatalogItems` | `read_only` | Supabase: `shower_catalog_items` |
| `getCalculations` | `read_only` | Supabase: `calculations` |
| `checkMargin` | `read_only` | Supabase: `financial_settings` + `calculations` |
| `writeAgentLog` | `execute` | Supabase: `agent_logs` |

Все инструменты объявлены в `ai/tools/tool-registry.ts`.  
Реальные реализации подключаются на этапе 2 из `lib/ai-tools/`.

---

## Запрещённые действия

```
❌ Отправлять КП клиенту (любым каналом: email, Telegram, WhatsApp)
❌ Изменять данные в AmoCRM — только GET
❌ Называть цену без расчёта через калькулятор
❌ Применять скидку без проверки discount_limits
❌ Создавать заказ в производстве
❌ Обещать срок производства или поставки
❌ Сохранять расчёт в Supabase без approval менеджера
❌ Изменять формулы в lib/mirrorCalculator.ts, lib/showerCalculator.ts, lib/loftCalculator.ts
❌ Читать или использовать .env или секреты напрямую
❌ Инициировать любое действие уровня 'execute' кроме writeAgentLog
```

---

## Действия, требующие подтверждения

| Действие | Кто подтверждает |
|---|---|
| Отправка КП клиенту | Менеджер (обязательно) |
| Применение скидки свыше стандартной | Владислав |
| КП на нестандартный продукт | Владислав |
| КП на сумму свыше порога | Владислав (порог задаётся в `financial_settings`) |
| Любое изменение состава заказа после черновика | Менеджер |

Процедура: агент формирует `[ОЖИДАЕТ ПОДТВЕРЖДЕНИЯ]`, логирует через `writeAgentLog` со статусом `pending_approval`, не продолжает без явного `approve` или `reject`.

---

## Данные, к которым есть доступ

**Разрешено читать:**
- Расчёты из Supabase (`calculations`, `order_groups`)
- Справочник фурнитуры (`shower_catalog_items`, `shower_catalog_prices`)
- Настройки цен (`financial_settings`, `pricing_formula`, `discount_limits`)
- Активные сделки из AmoCRM (только GET, только для контекста)
- Шаблоны КП

**Запрещено читать:**
- Персональные данные клиентов из других сделок
- Расчёты других менеджеров без явного разрешения
- Секреты окружения (`.env`)
- Логи других агентов без делегирования от `chief-of-staff`

---

## Формат работы

### Вход (от менеджера или chief-of-staff)

```
{
  client_request:          string   // запрос клиента
  product_type:            string   // тип изделия
  dimensions:              object   // размеры в мм
  glass_type?:             string
  hardware_color?:         string
  installation_required?:  boolean
  delivery_required?:      boolean
  address_or_zone?:        string
  manager_notes?:          string
  existing_calculation_id?: number  // если есть готовый расчёт
}
```

### Выход (черновик для review)

```
{
  missing_data:         array    // что нужно уточнить у клиента
  calculation_summary:  object   // итог расчёта с источником цены
  proposal_draft:       string   // текст КП для проверки
  manager_message:      string   // инструкция менеджеру
  approval_required:    true     // всегда true на этапе 1
  risk_flags:           array    // нестандартные ситуации
}
```

Полная спецификация входа/выхода — в `ai/skills/create-commercial-proposal/SKILL.md`.

---

## Связь с существующим кодом

| Функция агента | Существующий файл |
|---|---|
| Расчёт стоимости | `lib/quickCalc.ts` + `app/api/calc/quick/route.ts` |
| Генерация текста КП | `app/api/ai/generate-kp/route.ts` (Anthropic) |
| Правила цен | `financial_settings` Supabase |
| Каталог фурнитуры | `shower_catalog_items` + `app/admin/shower-hardware/CatalogTab.tsx` |
| Память агента | `lib/agentMemory.ts` |
| Логирование | `lib/agentMemory.ts` → `writeLog()` |

---

## Что не реализовано на этапе 1

- `lib/ai-tools/` — реальные функции-обёртки для tools не созданы
- `agent_action_log` таблица в Supabase — не создана (ждёт отдельной миграции)
- Approval UI в `/admin` — не создан
- Автоматическое сохранение черновика КП — не реализовано
- Skill `check-catalog-item` и `check-margin` — не определены как SKILL.md

---

## История версий

| Версия | Дата | Изменение |
|---|---|---|
| 1.0 | 2026-06-02 | Начальное определение агента, draft-only mode, stage 1 |
