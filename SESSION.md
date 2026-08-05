## Текущая задача
Личный кабинет B2B-заказчика — Фазы 0/1 + ядро калькулятора СДЕЛАНЫ. На проверку владельцу.
Спец: `docs/B2B_CLIENT_CABINET.md`. Ветка feat/b2b-client-cabinet (worktree mglass-b2b-cabinet).

## Сделано и проверено (tsc чисто, eslint чисто, 270/270 тестов)
КАЛЬКУЛЯТОР (идентичность клиент=менеджер):
- lib/b2b/computeQuote.ts — единый движок (calcItem + надбавки за габариты + услуги), зовут ОБА
- app/calculator/b2b/page.tsx — 3 сайта переведены на computeQuoteItem (drawing-import оставлен)
- app/api/partner/quote/route.ts — единый движок, реальные материалы/надбавки/триплекс/фацет
- app/partner/new/page.tsx — форма как у менеджера на реальных данных (зеркало 4/6, реальные типы, чипы надбавок)
- app/api/partner/materials — отдаёт материалы+фацет+надбавки (без cost). Тест __tests__/b2b/computeQuote.test.ts
БЕЗОПАСНОСТЬ (Фаза 0):
- Миграция 20260805_b2b_partner_isolation_backstop.sql — НЕ применена (прод-запись блокирует классификатор; применить в SQL Editor)
- Фикс 3 утечек API (drawing/attachments/docs-printed) + lib/partnerScope.ts
- Аудит partner-submit → security_events
ПРОВИЖИНИНГ (Фаза 0 шаг 3):
- app/api/admin/b2b-access + app/admin/b2b-access/page.tsx — выдать/отозвать доступ, ссылка set-password
КАБИНЕТ (Фаза 1):
- app/api/partner/stats + Табло в app/partner/page.tsx (заказов за год, сумма, средний чек, в работе)
- app/api/partner/order/[id] + app/partner/order/[id]/page.tsx — карточка заказа (позиции, чертёж, таймлайн)
- Карточки заказов кликабельны → карточка

## Фаза 2 — прогресс (ветка feat/b2b-cabinet-phase2)
- [x] Уведомления: partner submit → notifyAdmins() в Telegram (клиент, №, ссылка на /b2b-quotes)
- [x] Документы: печатное КП /partner/order/[id]/kp (позиции + цена клиента, без cost; window.print/PDF) + кнопка в карточке
- [x] /api/partner/order отдаёт clientName + реквизиты клиента (его данные) — задел под счёт
- Проверка: eslint чисто, tsc чисто, vitest 274/274
- #147 смёрджен в main; миграция безопасности ПРИМЕНЕНА владельцем (проверено: 20 политик + is_partner)

## Осталось (хвосты)
- Счёт-спецификация для клиента (juridical, реквизиты продавца + QR + сумма прописью) — переиспользовать app/b2b-quotes/[id]/invoice
- Партнёру пуш о смене статуса (у клиента нет Telegram; статус виден в кабинете вживую) — опционально email
- Реальный логотип в public/ (сейчас геометрическая заглушка в прототипе)
- Живой e2e-тест: /admin/b2b-access → выдать доступ → войти → проверить калькулятор/заказы/КП

## Что сделано (эта сессия)
- Проанализирован проект: партнёрский контур, auth/security, B2B-калькулятор, данные
- Найден готовый фундамент кабинета `/partner` (вход, ленты заказов, калькулятор, отправка в работу)
- Настроена изоляция: worktree `mglass-b2b-cabinet`, ветка `feat/b2b-client-cabinet` от main
- Зафиксированы решения владельца: все модули (табло/карточка/документы/уведомления),
  калькулятор = детали стекло+зеркало, запуск = пилот, вход = пароль+аудит (2FA на будущее)
- Написана спецификация архитектуры → `docs/B2B_CLIENT_CABINET.md`

## Фаза 0 — прогресс
- [x] Шаг 1: RLS-бэкстоп → `supabase/migrations/20260805_b2b_partner_isolation_backstop.sql`
      (хелпер `is_partner()` + `AND NOT is_partner()` во все широкие B2B-политики; безопасно для внутренних).
      ⚠️ Найдена реальная дыра: политика "auth" = FOR ALL authenticated на b2b_orders/b2b_clients +
      USING(true) на materials/services/attachments → любой залогиненный видел всё. Закрыто миграцией.
      НЕ ПРИМЕНЕНО — применить вручную в Supabase SQL Editor (владелец).
- [x] Шаг 2: аудит внутренних API. Исправлены 3 утечки (service-role без проверки роли):
      `/api/b2b/drawing/[orderId]`, `/api/b2b/attachments/[id]` (чужие чертежи по id),
      `/api/b2b-orders/[id]/docs-printed` (запись в чужой заказ). Добавлен `lib/partnerScope.ts`.
      Уже безопасны: adjust-total, launch-production, sync-stages, problem, payment, invoice-batch.
      Осталось по мелочи: `/api/b2b/parse-pdf` (не утечка данных, guard добавить позже).
- [ ] Шаг 3: админ-выдача доступа клиенту (учётка + привязка user_id + ссылка set-password), UI в /admin.
- [ ] Шаг 4: лог входов/действий партнёра в `security_events`.

## Калькулятор — единый расчёт (в работе)
Решение владельца: клиент и менеджер считают ОДНИМ модулем. Сверловка/вырезы — пока флаг (без цены).
- [x] `lib/b2b/computeQuote.ts` — общий `computeQuoteItem`/`computeQuoteTotals` (calcItem + надбавки за габариты + услуги)
- [x] `/api/partner/quote` переписан на общий модуль → теперь применяет надбавки b2b_surcharge_rules,
      триплекс, фацет, мин.цену, реальные материалы. Раньше звал движок с пустыми услугами → цена расходилась.
- [x] Тест-регресс `__tests__/b2b/computeQuote.test.ts` (надбавка применяется; мелкие детали без изменений) — зелёный
- [x] Менеджерская `app/calculator/b2b/page.tsx` переведена на `computeQuoteItem` (3 сайта: add/edit-preview/edit-save).
      Drawing-import (стр. 712) намеренно оставлен на calcItem (там без надбавок). tsc чисто, eslint чисто, 270 тестов зелёные.
- [x] UI `/partner/new` переписан под реальные данные: сегмент Стекло/Зеркало, толщина/тип из `b2b_materials`,
      тумблеры (закалка только стекло, фацет+мм, сверловка-флаг, криволинейка, мин.цена, триплекс+слои), чипы надбавок,
      живой пересчёт через `/api/partner/quote`. Материалы/фацет/надбавки — из `/api/partner/materials` (без cost).
- Проверка: tsc чисто по всем затронутым файлам, eslint чисто, `npx vitest run` = 270/270.
  ⚠️ `npm run build` в этом worktree падает из-за симлинка node_modules (Turbopack «points out of filesystem root»),
     это инфраструктура worktree, НЕ код; в обычном checkout/CI билд идёт.

## Осталось проверить вживую
Дым-тест кабинета (вход партнёром) — нужен тестовый partner-аккаунт. Логика доказана тестом
(надбавка применяется у клиента) + tsc/eslint. Параллельно ждёт Фаза 0 шаг 3 — админ-выдача доступа.

## Следующий шаг
Фаза 0, шаг 3: `/admin/b2b-access` — создать auth-учётку партнёру + привязать `b2b_clients.user_id`
+ роль `partner` + ссылка `set-password`. Переиспользовать `invite-link`/`set-password`.

## Контекст
- Ветка/worktree: mglass-b2b-cabinet (feat/b2b-client-cabinet от main); БД Supabase общая — миграции аддитивные
- `b2b_orders` — одна таблица (просчёт+заказ), статус в `notes` JSON, позиции в `items` JSONB
- Изоляция сейчас на коде (service-role + фильтр по user_id); усиливаем RLS-бэкстопом
- Цена клиента без cost/margin — уже так в `/api/partner/*`
- Движок цен общий: `lib/b2bCalculator.ts` + `lib/b2bMaterialPricing.ts`

## Открытые вопросы
- Канал уведомлений (email/Telegram) — к Фазе 2
- Отдельная org на партнёра vs deny-политика — выбрать при Рубеже 2
- Self-edit реквизитов клиентом — уточнить
