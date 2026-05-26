# Health Check Skill — Навык проверки здоровья системы

## Назначение
Автоматически проверять консистентность данных в БД, находить ошибки конфигурации и предлагать авто-исправления. Без него ошибки накапливаются незаметно и ломают расчёты.

## Модули и страницы
- `/admin/health-check` — страница с результатами всех проверок, авто-исправлениями и логом
- `/admin/ai-control-center` — вкладка health интегрирована в AI Control Center

## API маршруты
- `POST /api/admin/health-check/fix` — применить авто-исправление (admin/ceo only)
- `GET /api/cron/health` — автоматическая проверка (cron, требует Bearer CRON_SECRET)

## Таблицы БД
| Таблица | Роль |
|---------|------|
| `glass_price_matrix` | Проверка рассинхронизации с b2b_materials |
| `b2b_materials` | Проверка устаревших/отсутствующих записей |
| `users` | Проверка пользователей без роли (role IS NULL) |
| `materials` | Проверка критических остатков (stock_qty < min_stock_qty) |

## Ключевые файлы
| Файл | Роль |
|------|------|
| `lib/healthCheckRunner.ts` | Типы CheckResult, IssueMeta; маппинг проверок; авто-фиксы |

## Роли и доступ
- **admin**: полный доступ, может применять авто-исправления
- **ceo**: просмотр результатов, может применять исправления

## Входные данные
Запрос на запуск проверок (страница или cron).

## Выходные данные
`CheckResult[]` — массив результатов со статусами `ok/warn/error`, каждый с полями: `id, status, title, description, autoFix?, issueMeta`.  
`IssueMeta` — причина проблемы, рекомендация, действие авто-фикса.

## Что уже реализовано
- `lib/healthCheckRunner.ts` — полная типизация и структура проверок
- Страница `/admin/health-check` с детальными результатами и badge-статусами
- Авто-исправления:
  - `sync_b2b_materials` — добавляет недостающие записи в b2b_materials из glass_price_matrix
  - `sync_b2b_from_glass` — деактивирует устаревшие записи b2b_materials
  - `fix_roles_null` — назначает роль `manager` пользователям без роли
- Лог авто-исправлений (localStorage: `mglass_health_fix_log`)
- Cron-задача `/api/cron/health` с Telegram-алертом при проблемах
- Интеграция в AI Control Center (вкладка health)

## Что нужно доработать
- Хранение лога исправлений в БД (сейчас только localStorage — теряется при смене браузера)
- Дополнительные проверки: финансовые настройки без записей, мёртвые расчёты без заказа, дублированные клиенты
- Email-уведомление при критических ошибках (сейчас только Telegram)

## Риски
- `sync_b2b_from_glass` деактивирует записи без дополнительного подтверждения — риск скрытия актуальных материалов
- Cron `/api/cron/health` требует `CRON_SECRET` в заголовке — без него возвращает 401 без логов
- Авто-фикс `fix_roles_null` назначает роль `manager` всем — может дать лишний доступ

## Тесты
- Integration: `sync_b2b_materials` добавляет нужные записи в b2b_materials
- Integration: `fix_roles_null` назначает роль `manager` пользователям с role=null
- Unit: `runChecks()` возвращает корректную структуру `CheckResult[]`
- Cron: GET `/api/cron/health` с правильным токеном → 200 + Telegram при ошибках

## Связи с другими Skills
- **Pricing Skill** — проверяет консистентность glass_price_matrix и b2b_materials
- **B2B Skill** — проверяет b2b_materials на полноту
- **User & Access Skill** — проверяет роли пользователей
- **AI Control Center Skill** — отображает результаты health-check в своём интерфейсе
