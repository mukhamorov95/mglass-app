## Текущая задача
Нет активной задачи

## Что сделано (эта сессия — 13 мая 2026)

### Роли и навигация
- `lib/getRole.ts` — 5 ролей (admin/manager/production/seo/ceo), `canAccess()`, `ROLE_ALLOWED`
- `middleware.ts` — route protection, роль кэшируется в cookie `user-role` (1ч TTL)
- `components/Sidebar.tsx` — полная переработка: меню по ролям
  - manager: 3 аккордеона (Калькулятор B2C, Продажи B2C, B2B с 4 пунктами)
  - production: плоский список с лейблом "Производство"
  - seo: 3 аккордеона (Аналитика, Маркетинг, AI)
  - ceo: 3 аккордеона (Owner Center, Аналитика, Система)
  - admin: переключатель Менеджер/Админ/СЕО, бейдж роли под логотипом
- `app/access-denied/page.tsx` — страница "Нет доступа"

### PDF кириллица (QuotePDF.tsx)
- Скачаны TTF: `public/fonts/PTSans-Regular.ttf`, `public/fonts/PTSans-Bold.ttf`
- `Font.register()` с `path.join(process.cwd(), 'public', 'fonts', ...)`
- Исправлена сумма позиции: `item.saleIncVat` (итого за все штуки, не умножать на qty)

### Номера заказов
- Миграция `20250513_b2b_order_numbers.sql` — колонка `client_order_number` в `b2b_orders` ✅ ПРИМЕНЕНА
- Поля "Наш номер" / "№ клиента" в калькуляторе, б2б-просчётах, б2б-заказах
- Inline-редактирование номеров в б2б-заказах

### Менеджер видит только свои данные
- Миграция `20250513_manager_order_scope.sql` — `created_by uuid` + `see_all_orders boolean` ✅ ПРИМЕНЕНА
- `app/calculator/b2b/page.tsx` — сохраняет `created_by: managerId`
- `app/b2b-quotes/page.tsx` — фильтр `.eq('created_by', user.id)` если нет разрешения
- `app/b2b-orders/page.tsx` — аналогично
- `app/manager-dashboard/page.tsx` — локальные переменные `localRole/localSeeAll`, фильтр на уровне запроса; переключатель "Все/Только мои" скрыт для обычных менеджеров
- `app/admin/users/page.tsx` — колонка "Заказы" с toggle "Все/Свои" для менеджеров

### КП — общий м² и кг в PDF
- `components/QuotePDF.tsx` — добавлены поля `totalArea`/`totalWeight` в `QuotePDFProps`, отображаются под итоговой суммой (Площадь, Вес, Позиций)
- `app/api/quotes/[id]/pdf/route.ts` — добавлен select `total_area,total_weight`, передаются в `QuotePDFProps`
- HTML-версия (`app/b2b-quotes/[id]/kp/page.tsx`) — уже была с этими данными, изменений не требовала

### Себестоимость доп. услуг (триплекс и др.)
- `supabase/migrations/20250514_service_cost_price.sql` — миграция СОЗДАНА, но НЕ ПРИМЕНЕНА ещё
- `lib/types.ts` — добавлено `cost_price: number` в `B2BService`
- `lib/b2bCalculator.ts` — `costWithVatFull` теперь включает закупочную стоимость услуг
- `app/admin/b2b-services/page.tsx` — поле и колонка "Себестоимость" добавлены

### Аудит и исправления (полная проверка системы)
- `b2b-quotes/page.tsx` — `duplicateQuote()` теперь копирует `created_by`
- `app/api/quotes/[id]/pdf/route.ts` — проверка доступа (role/see_all_orders/created_by)
- `app/admin/users/page.tsx` — `?? false` для `see_all_orders` (защита от undefined)
- `calculator/b2b/page.tsx` — `saveError` state, ошибка показывается под кнопкой; `created_by: managerId ?? null`

### Согласованность данных в б2б-просчётах
- Позиции показывают полную цену до скидки — как в PDF
- Скидка отдельной строкой в tfoot
- Итоговая строка "Итого к оплате" = total_after_discount

## Следующий шаг
Применить миграцию `supabase/migrations/20250514_service_cost_price.sql` в Supabase SQL Editor (добавляет cost_price к b2b_services, ставит 2500 для триплекса)

## Контекст
- Обе миграции применены в Supabase ✅
- Cookie `user-role` кэшируется 1 час — при смене роли нужно подождать или сбросить cookie
- Шрифты PT Sans в `public/fonts/` — обязательны для PDF, не удалять
- manager03@mglass.ru — тестовый аккаунт менеджера (без see_all_orders)

## Открытые вопросы
- Нет
