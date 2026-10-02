-- Э6: ставки фондов розничного заказа душевой (слова владельца 01.10.2026).
-- Читают /cfo/order-economics/retail (lib/pricing/orderFundsStore.ts), пишет POST /api/cfo-settings.
-- RLS на cfo_settings без политик — строку видит только service-role.
alter table public.cfo_settings add column if not exists order_funds jsonb;

update public.cfo_settings
set order_funds = '{
  "as_of": "2026-10-01",
  "drawing_per_shower": 1500,
  "measure_per_shower": 2500,
  "install_per_glass": 4500,
  "delivery_moscow_per_order": 3500,
  "delivery_region_per_order": 5000,
  "tax_pct": 12,
  "manager_pct": 3,
  "realization_pct": 3,
  "partner_reserve_pct": 3,
  "partner_known_pct": 10,
  "other_pct": 1
}'::jsonb
where id = 1 and order_funds is null;
