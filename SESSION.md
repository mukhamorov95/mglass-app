## Текущая задача
Маршрут A1 — счёт-спецификация для партнёра (единый документ с менеджерским), за флагом владельца.

## Что сделано (эта сессия)
- Флаг self-invoice → supabase/migrations/20260825_b2b_clients_self_invoice.sql (b2b_clients.can_self_invoice, ПРИМЕНИТЬ)
- Единый компонент счёта → components/InvoiceDocument.tsx (forwardRef, сам считает итоги+QR)
- Рефактор менеджерского счёта на общий компонент → app/b2b-quotes/[id]/invoice/page.tsx (редактор реквизитов сохранён)
- Партнёрский endpoint счёта (гейт can_self_invoice + запущен) → app/api/partner/order/[id]/invoice-data/route.ts
- Страница счёта в кабинете → app/partner/order/[id]/invoice/page.tsx (read-only реквизиты, выбор юрлица, PDF)
- Гейт-кнопка на карточке заказа → app/api/partner/order/[id]/route.ts (canInvoice) + app/partner/order/[id]/page.tsx
- Тумблер владельца «Счёт клиенту: вкл/выкл» → app/admin/b2b-clients + overview API + b2b-access action set_self_invoice
- Фазз-паритет (офлайн, CI) → __tests__/audit/quote-engine-fuzz.test.ts (детерминизм движка, менеджер==клиент, надбавки реальны)

## Следующий шаг
Владельцу: применить миграцию 20260825; прогнать боевой аудит паритета на первых реальных просчётах;
включить «Счёт клиенту» нужному партнёру в /admin/b2b-clients. Дальше по маршруту — A2 (статус оплаты уже есть #206;
остаётся онлайн-оплата) или A3 (согласование чертежа).

## Контекст
Ветка feat/partner-a1-invoice от origin/main (main ушёл вперёд: профиль #207, оплата-статус #206, reorder #197).
Паритет цифр гарантирован конструктивно: счёт читает тот же b2b_orders, что менеджер; движок один (computeQuoteItem).
Счёт партнёру доступен ТОЛЬКО при can_self_invoice=true И запущенном заказе; иначе «счёт выставляет менеджер».
Проверки: tsc 0, eslint 0, 346/346 тестов.

## Открытые вопросы
- В «Документы» пока не выведен счёт (только КП) — можно добавить, когда orders API отдаст canInvoice по-заказно.
