## Текущая задача
Step 7 — экран фиксации проблем — ЗАКРЫТО

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

## Следующий шаг
Step 8: панель начальника производства — отдельный view для admin/ceo
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
- Step 7: провести ручную проверку отметки этапов на реальных заказах
- Step 7: экран фиксации проблем — нужна страница с выбором причины из списка
- Step 8: панель начальника производства — отдельный view для admin/ceo
- PWA manifest: добавить на шаге 10
