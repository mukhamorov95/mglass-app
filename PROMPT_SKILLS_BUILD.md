# ПРОМПТ: Skills Build — Создание файлов навыков MGlass

> Скопируй всё ниже и отправь Claude как первое сообщение новой сессии.

---

## Контекст проекта

MGlass — CRM + калькулятор для производства зеркал, лофт-перегородок и душевых. Next.js + Supabase.
Прочитай `SESSION.md` и `MGLASS_SYSTEM_RULES.md` перед тем как что-то делать.

---

## Что такое Skills в этом проекте

Система разбита на 14+1 Skill (навыков) — самостоятельных областей с чёткими границами.
Каждый Skill имеет свой файл в `skills/`. Файл — это живой контракт: что принимает, что возвращает, какие таблицы трогает, какие риски, какие тесты.

**Главный источник истины:** `docs/MGLASS_AI_SKILLS_MAP.md` — содержит описания всех Skills.

**Эталонный формат файла:** смотри `skills/calculation-skill.md` — именно такой уровень детализации нужен.

---

## Что уже сделано (не переделывай)

- `skills/README.md` — объяснение зачем нужны Skills ✅
- `skills/calculation-skill.md` — Calculation Skill (полный) ✅
- `skills/commercial-proposal-skill.md` — Commercial Proposal Skill (полный) ✅

---

## Твоя задача

Создать файлы для **12 недостающих Skills** в папке `skills/`:

| Файл | Skill |
|------|-------|
| `pricing-skill.md` | Pricing Skill |
| `order-management-skill.md` | Order Management Skill |
| `b2b-skill.md` | B2B Skill |
| `procurement-skill.md` | Procurement Skill |
| `logistics-skill.md` | Logistics Skill |
| `measurement-skill.md` | Measurement Skill |
| `health-check-skill.md` | Health Check Skill |
| `ai-control-center-skill.md` | AI Control Center Skill |
| `user-access-skill.md` | User & Access Skill |
| `integration-skill.md` | Integration Skill |
| `content-skill.md` | Content Skill |
| `ceo-analytics-skill.md` | CEO Analytics Skill |
| `cfo-skill.md` | CFO Skill (новый — `/admin/cfo`) |

---

## Обязательный формат каждого файла

За основу бери описание из `docs/MGLASS_AI_SKILLS_MAP.md`, но **дополни и уточни**:
- Перепроверь пути файлов по реальной структуре проекта (читай файлы через Read/Bash)
- Уточни какие поля реально есть в таблицах БД
- Добавь актуальные риски которые видишь в коде

```markdown
# [Название] Skill — [Русский перевод]

## Назначение
<одно-два предложения: что делает этот Skill и для кого>

## Модули и страницы
- `/path` — что здесь

## API маршруты
- `METHOD /api/path` — что делает

## Таблицы БД
| Таблица | Роль |
|---------|------|
| `table_name` | что хранит, ключевые колонки |

## Ключевые файлы
| Файл | Роль |
|------|------|
| `lib/file.ts` | что делает |

## Роли и доступ
- role: что может делать

## Входные данные
<что принимает Skill на вход>

## Выходные данные
<что возвращает Skill>

## Что уже реализовано
- конкретные фичи, не абстрактные

## Что нужно доработать
- конкретные задачи

## Риски
- что может сломаться и почему

## Тесты
- Unit: ...
- Integration: ...
- Smoke: ...

## Связи с другими Skills
- **[Skill Name]** — как связаны (источник данных / потребитель / оба)
```

---

## CFO Skill — отдельная инструкция

`skills/cfo-skill.md` описывает страницу `/admin/cfo` которая только что создана.
Источник деталей: `PROMPT_CFO_MODULE.md` и `app/admin/cfo/page.tsx`, `app/admin/cfo/CfoClient.tsx`.

Ключевые моменты:
- Таблица `cfo_settings` (singleton id=1) — требует SQL миграции (ещё не задеплоена)
- Формулы: ТБ0, ТБ1, ДДС для трёх налоговых систем
- API: `POST /api/cfo-settings` — upsert настроек

---

## Приоритет создания

Начни с критичных:
1. `pricing-skill.md` (много зависимостей, много таблиц)
2. `order-management-skill.md` (центральный для бизнеса)
3. `health-check-skill.md` (уже реализован, надо зафиксировать)
4. Остальные в произвольном порядке

---

## После завершения

Обнови `skills/README.md` — раздел "Список всех Skills" должен отражать актуальный список файлов.

---

*Хранится в `PROMPT_SKILLS_BUILD.md`. Обновляй при добавлении новых Skills.*
