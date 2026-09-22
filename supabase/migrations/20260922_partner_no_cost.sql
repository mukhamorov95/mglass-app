-- Партнёр видел НАШУ себестоимость и маржу по своим заказам.
--
-- Политика «Partner reads own orders» отдавала строку b2b_orders целиком:
-- total_cost_net, total_cost_vat, margin_percent, а внутри items[] —
-- costMaterial, costExVat, costTempering, wastePercent, margin по каждой позиции.
-- Замер от имени партнёра MR GLASS (user 3114f511…) до правки: 785 заказов,
-- у 245 видна себестоимость, максимум 531 335 ₽, маржа до 75%.
-- RLS отсекает строки, но не колонки, поэтому «показать заказ без себестоимости»
-- этой политикой не выражается.
--
-- Решение владельца 22.09.2026: «ни в коем случае, чтобы клиент видел свою
-- себестоимость». Кабинет партнёра и так ходит только через /api/partner/*,
-- где данные собирает сервисный ключ и отдаёт лишь безопасные поля
-- (lib/b2b/publicQuote.ts, белый список). Прямое чтение таблицы кабинету не
-- нужно ни в одном экране — проверено по коду.
drop policy if exists "Partner reads own orders" on b2b_orders;

-- То же про карточку клиента: в ней наши внутренние CRM-поля (crm_notes,
-- crm_score, crm_segment, crm_manager). Профиль партнёра собирает API.
drop policy if exists "Partner reads own client" on b2b_clients;

-- Остальные «партнёрские» политики читали b2b_clients внутри своего предиката,
-- то есть после закрытия карточки всё равно отдавали бы пусто. Кабинет их не
-- использует: все экраны партнёра ходят через /api/partner/* с сервисным ключом
-- (проверено по коду — ни одного прямого запроса к таблицам из браузера).
-- Правило становится простым и проверяемым: партнёр не читает базу напрямую,
-- только через наши маршруты, где поля отбираются белым списком.
drop policy if exists "Partner reads own attachments" on b2b_calculation_attachments;
drop policy if exists "partner_claims_select_own" on partner_claims;
drop policy if exists "partner_notifications_select_own" on partner_notifications;
