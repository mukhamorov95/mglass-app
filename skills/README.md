# Skills — Навыки системы MGlass

## Что такое Skills в MGlass

Skills (навыки) — это способ разбить систему MGlass на самостоятельные, ограниченные по ответственности модули. Каждый Skill — это **контракт**: входные данные → обработка → выходные данные.

Слово «навык» выбрано намеренно: как у человека есть навыки (считать, продавать, закупать), так и у системы есть навыки. AI-агент может вызывать нужный навык, не зная, как он реализован внутри.

**Пример:** Calculation Skill умеет считать стоимость зеркала. Он не знает, как выглядит интерфейс, как устроена база данных B2B или как работает Telegram-бот. Он просто принимает размеры + опции → возвращает цену + разбивку.

---

## Почему мы делим систему на Skills

1. **Управляемость.** 120+ страниц и 100+ API-роутов — без разбивки невозможно понять, что за что отвечает.

2. **Независимое развитие.** B2B Skill можно развивать, не трогая Logistics Skill. Content Skill можно передать маркетологу, не рискуя сломать расчёты.

3. **Работа с AI.** Каждый Skill — это чёткая граница контекста для Claude. Агент знает: «Я работаю в рамках Procurement Skill» — и не лезет в калькуляторы.

4. **Тестирование.** Каждый Skill тестируется независимо. Если Pricing Skill зелёный — Calculation Skill получает корректные цены.

5. **Приоритизация.** Некоторые Skills критичны (без них бизнес встанет), другие — улучшают жизнь, но не блокируют продажи.

---

## Список всех 14 Skills

| # | Skill | Файл | Приоритет |
|---|-------|------|-----------|
| 1 | Calculation Skill | `calculation-skill.md` | Критично |
| 2 | Commercial Proposal Skill | `commercial-proposal-skill.md` | Критично |
| 3 | Pricing Skill | `pricing-skill.md` | Критично |
| 4 | Order Management Skill | `order-management-skill.md` | Критично |
| 5 | Health Check Skill | `health-check-skill.md` | Критично |
| 6 | B2B Skill | `b2b-skill.md` | Следующий этап |
| 7 | Procurement Skill | `procurement-skill.md` | Следующий этап |
| 8 | Logistics Skill | `logistics-skill.md` | Следующий этап |
| 9 | Measurement Skill | `measurement-skill.md` | Следующий этап |
| 10 | AI Control Center Skill | `ai-control-center-skill.md` | Будущее |
| 11 | User & Access Skill | `user-access-skill.md` | Основа |
| 12 | Integration Skill | `integration-skill.md` | Будущее |
| 13 | Content Skill | `content-skill.md` | Будущее |
| 14 | CEO Analytics Skill | `ceo-analytics-skill.md` | Будущее |

---

## Как Skills взаимосвязаны

```
Pricing Skill
  ↓ цены
Calculation Skill
  ↓ расчёты
Commercial Proposal Skill ←→ Integration Skill (PDF, WhatsApp)
  ↓ утверждённые расчёты
Order Management Skill
  ↓ заказы
Logistics Skill (доставка, бригады)
CEO Analytics Skill (выручка, маржа)

B2B Skill
  ↓ цены из Pricing Skill
  ↓ просчёты → КП через Commercial Proposal Skill
  ↓ заказы → Logistics Skill

Procurement Skill
  ↓ обновляет цены в Pricing Skill
  ↓ маршруты через Logistics Skill

Health Check Skill
  ↑ проверяет Pricing Skill (синхрон матрицы)
  ↑ проверяет User & Access Skill (роли)
  → репортует в AI Control Center Skill

AI Control Center Skill
  ↑ данные от CEO Analytics Skill
  ↑ данные от Calculation Skill
  ↑ статус от Health Check Skill

User & Access Skill
  → контролирует доступ ко ВСЕМ Skills
```

---

## Какие Skills критичны

**Без них бизнес не работает:**
1. **Calculation Skill** — нет расчётов → нет продаж
2. **Pricing Skill** — нет цен → нет расчётов
3. **Order Management Skill** — нет заказов → нет производства
4. **Commercial Proposal Skill** — нет КП → нет продаж
5. **User & Access Skill** — нет доступа → никто не может работать

**Критично для качества (не для выживания):**
6. **Health Check Skill** — без него незаметно накапливаются ошибки

---

## Какие Skills можно развивать независимо

**Полностью независимы:**
- **Content Skill** — маркетинг, контент-план, медиабиблиотека
- **CEO Analytics Skill** — аналитика (читает только, не пишет)
- **Measurement Skill** — форма замера, календарь

**Относительно независимы:**
- **Logistics Skill** — зоны доставки и бригады не блокируют продажи
- **Procurement Skill** — можно обновлять цены вручную без этого Skill

**Зависимы по данным, но независимы по разработке:**
- **B2B Skill** — зависит от Pricing Skill по ценам, но разрабатывается отдельно
- **AI Control Center Skill** — потребляет данные от других Skills, но не влияет на них

---

## Какие Skills могут стать отдельными продуктами

1. **B2B Skill** — SaaS для стекольных компаний: B2B калькулятор + CRM + раскрой. Тиражируемый продукт.

2. **Calculation Skill** — виджет расчёта стоимости для сайтов остекления. Встраиваемый калькулятор.

3. **Health Check Skill** — система мониторинга данных для производственных компаний. Отдельный SaaS.

4. **Content Skill** — AI-маркетолог для дизайн-студий и ремонтных компаний.

5. **AI Control Center Skill** — AI-советник для малого бизнеса (анализирует данные, даёт рекомендации).

---

## Как работать с документацией Skills

Каждый файл Skill содержит:
- Что уже реализовано (используй смело)
- Что нужно доработать (задачи для разработки)
- Риски (не трогай без тестирования)
- Тесты (напиши перед деплоем)
- Связи (что сломается, если изменишь этот Skill)

При добавлении нового функционала:
1. Определи, к какому Skill он относится
2. Обнови файл Skill (раздел "Что реализовано")
3. Добавь тесты
4. Проверь связи с другими Skills
