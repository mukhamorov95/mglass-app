-- Плательщик заказа отдельно от заказчика: заказ идёт на клиента (Дмитрий
-- Воронеж), но счёт выставляется на другое юрлицо (MR GLASS). null = платит
-- сам заказчик (как было). Используется единым счётом на несколько заказов.
alter table b2b_orders
  add column if not exists payer_client_id bigint references b2b_clients(id);
create index if not exists idx_b2b_orders_payer on b2b_orders (payer_client_id);
