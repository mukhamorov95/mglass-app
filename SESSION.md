## Текущая задача
Access Control: Root Route Matching Fix — ЗАКРЫТО

## Что сделано (эта сессия)
- Step 7 — экран фиксации проблем:
  - lib/productionStages.ts → добавлены PROBLEM_REASONS (9 причин) + поле reason в DetailStageState
  - app/production-app/orders/[id]/page.tsx → ProblemModal компонент (выбор причины + комментарий)
  - markStage('problem') теперь открывает модал вместо немедленной записи
  - saveProblem(reason, note) сохраняет reason + note в notes.detail_stages[idx].problem
- Step 3 — роли и доступ:
  - lib/getRole.ts → убран /b2b-orders из роли production
  - middleware.ts → production-пользователь с / редиректится на /production-app
  - components/Sidebar.tsx → убраны мёртвые ссылки /b2b-orders и /manager-dashboard из PRODUCTION_ITEMS
- Step 4 — главный экран:
  - app/production-app/page.tsx → server component, загружает b2b_orders, считает 4 счётчика, список заказов по дедлайну
- Step 5 — экран заказа:
  - app/production-app/orders/[id]/page.tsx → полный client component, список деталей, групповые действия, запись в notes.detail_stages
- Step 6 — QR Compatibility Check:
  - lib/productionStages.ts → создан общий helper с типами и логикой этапов
  - app/p/o/[orderId]/page.tsx → переведён на импорт из productionStages
  - app/production-app/orders/[id]/page.tsx → переведён на импорт, добавлена ссылка "QR-экран" → /p/o/{id}

## Production App: QR Compatibility Check — ЗАКРЫТО

### Коммит
be0ed58 — feat(production-app): align order screen with qr workflow

### Что закрыто
/p/o/{id} и /production-app/orders/{id} теперь используют общий источник типов и логики этапов.

### Новый общий helper
lib/productionStages.ts

Содержит:
- DetailStageKey
- DetailStageState
- DetailStages
- isMirrorItem
- itemNeedsTempering

### Зачем это важно
Раньше логика этапов, зеркал и закалки была продублирована в двух интерфейсах.
Теперь изменение формата этапов или логики зеркал можно делать в одном месте.
Это снижает риск расхождения между QR-интерфейсом и Production App.

### Что не изменилось
- Формат notes.detail_stages не изменён
- Stage keys не изменены
- Item indexes не изменены
- Запись notes осталась через JSON.stringify(updatedNotes)
- Миграций нет

### Production test-plan
1. Открыть /production-app/orders/{id}
2. Нажать "QR-экран"
3. Проверить переход на /p/o/{id}
4. Отметить этап в Production App
5. Открыть тот же заказ в /p/o/{id}
6. Убедиться, что отметка видна
7. Отметить этап в /p/o/{id}
8. Обновить Production App
9. Убедиться, что отметка видна
10. Проверить, что у зеркал не доступна закалка

## Production App: Step 8 Manual Production Validation — ЗАКРЫТО

### Проверенный заказ

#609

### Проверенные маршруты

- /production-app/orders/609
- /p/o/609
- /b2b-orders

### Что подтвердили

- Production App открывает реальный заказ;
- QR-ссылка открывает /p/o/609;
- QR-экран загружает тот же заказ;
- отметки этапов синхронизируются между Production App и QR-экраном;
- отметки видны в /b2b-orders в прогрессе по деталям;
- общий формат notes.detail_stages работает;
- back-link на QR-экране ведёт в /production-app.

### Что исправили во время Step 8

- e784c67 — увеличена кликабельная зона QR-ссылки;
- 0266cb7 — QR-ссылка заменена на нативный <a href>, чтобы обойти нестабильность soft navigation;
- 46e98be — /p/o явно разрешён для production-role, ссылки назад исправлены с /b2b-orders на /production-app.

### Важный вывод

Первый рабочий контур Production App подтверждён:

Production App ↔ QR-экран ↔ B2B Orders

### Следующие возможные шаги

1. Панель начальника производства: список проблем и заказов с риском.
2. Возможность снять ошибочную отметку этапа.
3. История изменений по детали: кто/когда отметил этап.

## Access Control: Root Route Matching Fix — ЗАКРЫТО

### Коммит

be4f698 — fix(access): restrict root route matching

### Что было не так

`'/'` в ROLE_ALLOWED фактически открывал все маршруты, потому что `p === '/'` всегда возвращал `true` внутри `allowed.some(...)`.

### Что исправлено

Теперь `p === '/'` разрешает только `pathname === '/'`.

Остальные маршруты работают через:

```ts
pathname === p || pathname.startsWith(p + '/')
```

### Почему это важно

Это закрывает опасную дыру в role-based access control: production-role больше не получает доступ к управленческим и административным страницам только из-за наличия `'/'` в allowed routes.

### Что проверять на production

Production-role должен иметь доступ:

- /production-app
- /production-app/orders/609
- /p/o/609

Production-role НЕ должен иметь доступ:

- /b2b-orders
- /b2b-quotes
- /admin/users
- /calculator/b2b

Manager/admin/ceo/buyer должны сохранить свои разрешённые маршруты согласно ROLE_ALLOWED.

### Что НЕ трогалось

- Production App UI
- QR route UI
- notes
- detail_stages
- stage tracking
- Supabase
- RLS
- middleware redirects

## Следующий шаг
Step 10 — Supervisor Panel / Панель начальника производства:
  - Маршрут: /production-app/supervisor (или /admin/production)
  - Показывает все активные заказы со статусами этапов
  - Фильтр по проблемам (быстро найти позиции с браком)
  - Счётчики: Активных / Просрочено / Проблемы / Упаковано

## Контекст
- Production App: /production-app (главный экран) + /production-app/orders/{id} (экран заказа)
- Данные: b2b_orders.notes.detail_stages — единый источник для обоих интерфейсов
- lib/productionStages.ts — общий helper для типов и логики зеркал/закалки
- Главный экран: server component, фильтрует по notes.status != 'quote' + archived_at IS NULL
- Счётчики: Активных / Просрочено / Проблемы / Упаковано
- Сортировка: overdue → today → tomorrow → normal → ready → shipped

## Открытые вопросы
- Step 10: панель начальника производства — отдельный view для admin/ceo
- PWA manifest: добавить на позднем шаге
