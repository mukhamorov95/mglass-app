## Текущая задача
Step 12 — Detail Stage Audit Visibility — ЗАКРЫТО

## Что сделано (эта сессия)
- Step 7 — экран фиксации проблем (ЗАКРЫТО)
- Step 10 — Supervisor Panel (ЗАКРЫТО): /production-app/supervisor
- Step 11 — Stage Undo (ЗАКРЫТО): кнопка ✕ на этапах + UndoModal + audit trail
- Step 12 — Audit Visibility (ЗАКРЫТО): read-only блок "История изменений" в экране заказа

## Production App: Step 12 Detail Stage Audit Visibility — ЗАКРЫТО

### Коммит
5abbb94 — feat(production-app): show stage audit trail

### Что добавлено

- На странице /production-app/orders/[id] появился read-only блок "История изменений".
- Блок показывается только если в notes.detail_stage_audit есть записи.
- Показываются последние 10 записей, отсортированных по created_at по убыванию.
- Если audit пустой — блок не показывается.

### Что отображается в истории

Для каждой записи:
- дата/время;
- позиция (Поз.N);
- этап (из STAGE_LABELS);
- бейдж "отмена";
- причина;
- кто отменил (created_by_email, если есть);
- предыдущий статус (previous_value, если есть).

### Безопасность

- Блок только читает notes.detail_stage_audit.
- Новых .update() не добавлено.
- Новых insert/delete/upsert нет.
- Существующие .update({ notes: JSON.stringify(updatedNotes) }) остались только в persistStageUpdate и unsetStage.
- notes.detail_stages не менялся.
- Stage keys не менялись.
- QR route не менялся.
- Supervisor panel не менялась.
- Миграций нет.

### Production test-plan

На заказе #609:

1. Открыть /production-app/orders/609.
2. Если ранее была отмена этапа — проверить, что внизу появился блок "История изменений".
3. Проверить запись: позиция, этап, дата/время, причина, кто отменил, предыдущий статус.
4. Открыть заказ без отмен — блок должен отсутствовать.
5. Выполнить новую отмену этапа — история обновляется сразу (без перезагрузки).
6. Проверить, что постановка и отмена этапов продолжают работать.

## Production App: Step 11 Stage Undo with Audit Trail — ЗАКРЫТО

### Коммит
0bd9fa7 — feat(production-app): add stage undo with audit trail

### Что добавлено

- На карточках позиций в /production-app/orders/[id] рядом с выполненными этапами появилась кнопка отмены ✕.
- Отменять можно обычные этапы: cutting / polishing / drilling / tempering / packaging.
- Также можно отменить problem.
- При отмене открывается UndoModal (textarea для причины + кнопка подтверждения).
- Без причины отмена не сохраняется.
- После отмены stage key удаляется из notes.detail_stages[itemIndex][stageKey].

### Audit trail

Отмена не удаляет историю бесследно.

При каждой отмене создаётся запись в:

```
notes.detail_stage_audit
```

Формат audit-записи:

```ts
{
  type: 'stage_unset',
  item_index: number,
  stage_key: DetailStageKey,
  previous_value: DetailStageState,
  reason: string,
  created_at: string,
  created_by: string,
  created_by_email: string
}
```

Если `notes.detail_stage_audit` уже есть — запись дозаписывается. Если нет — создаётся массив.

### Почему это важно

В производстве рабочий или руководитель может ошибочно отметить не тот этап или не ту позицию. Теперь ошибочную отметку можно снять, но с сохранением следа: кто, когда, какой этап снял и по какой причине.

### Что НЕ изменилось

- Stage keys не изменялись.
- lib/productionStages.ts не менялся.
- /p/o/[orderId] не менялся.
- /production-app/supervisor не менялся.
- notes по-прежнему пишется через JSON.stringify(updatedNotes).
- Миграций нет.
- RLS не трогался.
- Middleware не трогался.

### Что проверить на production

На заказе #609:

1. Открыть /production-app/orders/609.
2. Найти выполненный этап, например "Полировка".
3. Нажать ✕ рядом с бейджем.
4. Ввести причину: Тестовая отмена ошибочной отметки.
5. Нажать "Отменить этап".
6. Убедиться, что бейдж этапа исчез, toast показал `✓ Отмена: Полировка (поз.N)`.
7. Открыть /p/o/609 — этап тоже исчез.
8. Открыть /b2b-orders — прогресс этапа уменьшился.
9. Убедиться, что остальные этапы не пропали.
10. Заново поставить этап — сохраняется корректно.

## Production App: Step 10 Supervisor Panel — ЗАКРЫТО

### Коммит
3d3a42f — feat(production-app): add supervisor panel

### Маршрут
/production-app/supervisor

### Доступ
- admin: всегда (canAccess → return true)
- ceo: через /production-app в ROLE_ALLOWED.ceo (покрывает /production-app/*)
- production/manager: redirect → /production-app

### Что показывает
- Статкарды: Активных / Просрочено / Проблемы / Упаковано
- Табы-фильтры через URL searchParams: Все / Просрочено / Проблемы / Сегодня—Завтра / Упаковано
- Список заказов: сортировка overdue → today → tomorrow → normal → ready, проблемные наверх внутри группы
- Карточка: лейбл + клиент + дедлайн-бейдж + прогресс-бар + список проблем с позицией и причиной
- Ссылки: → Заказ + → QR-экран

## Production App: QR Compatibility Check — ЗАКРЫТО

### Коммит
be0ed58 — feat(production-app): align order screen with qr workflow

### Что закрыто
/p/o/{id} и /production-app/orders/{id} используют общий источник типов и логики этапов через lib/productionStages.ts.

## Access Control: Root Route Matching Fix — ЗАКРЫТО

### Коммит
be4f698 — fix(access): restrict root route matching

### Что было не так
'/' в ROLE_ALLOWED фактически открывал все маршруты (p === '/' всегда true внутри allowed.some).

### Что исправлено
Теперь p === '/' разрешает только pathname === '/'.

## Следующий шаг
Step 13 — Supervisor Panel: Audit / Recent Changes indicator:
- В /production-app/supervisor добавить read-only индикатор по заказам с отменами
- Показывать: есть ли отмены, когда последняя, кто отменил, ссылка "Открыть заказ"
- Данные уже в notes.detail_stage_audit — новых записей в БД не потребуется
- Усиливает контроль начальника производства без изменения схемы данных

## Контекст
- Production App: /production-app (главный экран) + /production-app/orders/{id} (экран заказа)
- Supervisor Panel: /production-app/supervisor (только admin/ceo)
- Данные: b2b_orders.notes.detail_stages — единый источник для обоих интерфейсов
- Audit: b2b_orders.notes.detail_stage_audit — лог отмен этапов
- lib/productionStages.ts — общий helper для типов и логики зеркал/закалки
- Главный экран: server component, фильтрует по notes.status != 'quote' + archived_at IS NULL
- Счётчики: Активных / Просрочено / Проблемы / Упаковано
- Сортировка: overdue → today → tomorrow → normal → ready → shipped

## Открытые вопросы
- PWA manifest: добавить на позднем шаге
- Step 13: Audit indicator в supervisor panel
