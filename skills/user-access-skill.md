# User & Access Skill — Навык управления доступом

## Назначение
Управлять пользователями, ролями и тонкими правами. Контролирует кто и что видит во всей системе. Базовый Skill — без него невозможна безопасная работа команды.

## Модули и страницы
- `/admin/users` — список пользователей: роль, права, код менеджера
- `/admin/org` — оргструктура: схема ролей с функциями и KPI
- `/admin/org/[roleId]` — карточка роли: функции, KPI, регламент
- `/admin/org/[roleId]/print` — печать регламента роли

## API маршруты
- `GET/POST /api/admin/users` — список/создание пользователей
- `POST /api/admin/invite` — пригласить пользователя по email
- `GET/POST /api/admin/role-assignments` — назначения ролей
- `PATCH/DELETE /api/admin/role-assignments/[id]` — редактирование/удаление
- `POST /api/admin/seed-managers` — создание тестовых менеджеров
- `POST /api/auth/setup-org` — начальная настройка организации

## Таблицы БД
| Таблица | Роль |
|---------|------|
| `users` | id (auth.uid), role, permissions (jsonb), manager_code (int), can_delete (bool), max_discount_percent (int) |

## Ключевые файлы
| Файл | Роль |
|------|------|
| `lib/getRole.ts` | `getRole()`, `getUserProfile()`, `canAccess()`, `ROLE_ALLOWED` — центральная логика доступа |
| `lib/permissions.ts` | Тип `UserPermissions`, `DEFAULT_PERMISSIONS` — тонкие права |
| `lib/roles-data.ts` | Описания ролей для оргструктуры |
| `middleware.ts` | SSR-защита маршрутов: redirect на `/login` или `/access-denied` |

## Роли и доступ
Система поддерживает 6 ролей:
- **admin** — полный доступ ко всему без ограничений
- **ceo** — Owner Center, дашборды, аналитика, CFO, управление командой
- **manager** — калькуляторы, расчёты, заказы, клиенты, B2B, замеры
- **production** — производство, B2B пайплайн, заказы (только просмотр/статус)
- **buyer** — закупки, склад, справочники цен, маршруты
- **seo** — маркетинг, аналитика, AI-статистика, AMO-воронка

## Тонкие права (`UserPermissions`)
Поверх роли — JSON-объект с булевыми флагами:
- `see_mglass` — видит B2C калькуляторы
- `see_b2b` — видит B2B раздел
- `see_calendar` — видит календарь
- `see_clients` — видит список клиентов
- `see_earnings` — видит свои комиссионные

## Входные данные
Email, роль, permissions JSON, manager_code (числовой код для идентификации в расчётах).

## Выходные данные
Пользователь с настроенной ролью, правами и кодом. Redirect на нужную страницу при авторизации.

## Что уже реализовано
- `getRole()` и `getUserProfile()` — серверные функции для проверки роли
- `canAccess(role, pathname)` — проверка доступа к пути
- `ROLE_ALLOWED` — полный маппинг роль → разрешённые пути
- `middleware.ts` — SSR-redirect неавторизованных и пользователей без прав
- Тонкие права `UserPermissions` с дефолтами в `DEFAULT_PERMISSIONS`
- Страница `/admin/users` с управлением пользователями
- Оргструктура с карточками ролей и печатью регламента

## Что нужно доработать
- UI управления `permissions` JSON прямо в форме пользователя (сейчас только в коде)
- Row Level Security в Supabase (сейчас роли только на уровне приложения — обходится прямыми API-запросами)
- Аудит-лог изменений прав (кто когда изменил роль пользователя)

## Риски
- Проверка роли в middleware делает запрос к БД на каждом SSR-запросе — при высокой нагрузке станет узким местом
- Нет RLS в Supabase — admin/ceo через прямые API-запросы могут читать данные других без middleware
- Если `users` таблица недоступна, `getRole()` возвращает null → redirect на `/login` для всех

## Тесты
- Unit: `canAccess('manager', '/admin/dashboard')` → `false`
- Unit: `canAccess('admin', '/any/path')` → `true`
- Integration: middleware перенаправляет неавторизованного на `/login`
- Integration: пользователь без роли получает `/access-denied`
- Integration: менеджер без `see_b2b` не видит B2B-раздел

## Связи с другими Skills
- **Все Skills** — `getRole()` и `canAccess()` используются в каждом серверном компоненте и API-роуте
- **Health Check Skill** — проверяет наличие пользователей без роли (`fix_roles_null`)
