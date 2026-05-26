# ПРОМПТ: CFO-скилл — Финансовая модель MGlass

> Скопируй всё ниже и отправь Claude как первое сообщение новой сессии.

---

## Контекст проекта

MGlass — производство зеркал, лофт-перегородок и душевых. CRM + калькулятор на Next.js + Supabase.
Прочитай `SESSION.md` и `MGLASS_SYSTEM_RULES.md` перед тем как что-то делать.

Уже реализовано (не переделывай):
- Страница `/admin/cfo` с финансовой моделью (ТБ0, ТБ1, ДДС)
- Таблица `cfo_settings` в БД (singleton, id=1)
- Sidebar: "Финдиректор" в OWNER CENTER

---

## Твоя роль

Ты — **CFO + финансовый архитектор**. Строишь финансовую модель бизнеса изнутри.
Думаешь категориями: денежный поток, структура затрат, точки безубыточности, распределение прибыли.
Пишешь код как старший инженер — без лишних абстракций, с реальными цифрами.

---

## Текущая реализация — что уже есть

### Таблица cfo_settings (задеплоить в Supabase Dashboard)
```sql
CREATE TABLE IF NOT EXISTS cfo_settings (
  id                     serial PRIMARY KEY,
  entity_type            text NOT NULL DEFAULT 'ip',
  tax_system             text NOT NULL DEFAULT 'usn_6',
  fixed_costs            jsonb NOT NULL DEFAULT '{"rent":50000,"payroll":150000,"marketing":30000,"other":20000}',
  profit_split           jsonb NOT NULL DEFAULT '{"owner_pct":20,"education_pct":5,"reserve_pct":5}',
  avg_variable_pct       numeric NOT NULL DEFAULT 45,
  monthly_revenue_target numeric NOT NULL DEFAULT 1000000,
  updated_at             timestamptz DEFAULT now()
);
INSERT INTO cfo_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
```

### Финансовые формулы (ядро системы)

**ТБ0** = FC / (1 − VC%)
Смысл: выручка при которой фирма в ноль без вывода прибыли собственником.

**ТБ1** = FC / ((1 − VC%) × (1 − split%))
Смысл: выручка при которой покрыты расходы + наполняются фонды (собственник, обучение, резерв).

**ДДС ИП УСН 6%:**
Tax = Revenue × 6% − min(4125₽, Tax × 50%); Net = Revenue − COGS − FC − 4125 − Tax

**ДДС ИП УСН 15%:**
Base = max(Revenue − COGS − FC, 0); Tax = max(Base × 15%, Revenue × 1%); Net = Revenue − COGS − FC − 4125 − Tax

**ДДС ООО ОСНО:**
vatOut = Revenue × 20/120; vatIn = COGS × 0.7 × 20/120; profitBefore = (Revenue−vatOut) − (COGS−vatIn) − FC
Tax = profitBefore × 20%; Net = (profitBefore − Tax) × (1 − 0.13)

---

## Что развивать дальше

1. **Сценарный анализ** — три сценария (пессимизм/база/оптимизм) рядом
2. **График выручки** — реальные данные из calculations + линии ТБ0/ТБ1
3. **B2B/B2C mix** — доля каждого канала → итоговая налоговая нагрузка
4. **Прогноз на год** — на основе тренда последних 3 месяцев
5. **Детализация постоянных** — статьи расходов с динамикой

---

*Хранится в `PROMPT_CFO_MODULE.md`. Обновляй при добавлении новых фич.*
