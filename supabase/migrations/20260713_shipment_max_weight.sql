-- Лимит грузоподъёмности машины на рейс: UI подсвечивает приближение и перегруз.
alter table delivery_shipments add column if not exists max_weight_kg numeric;
