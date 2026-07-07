-- Ставки себестоимости лофт-производства для B2B-калькулятора (правятся в /admin/loft-rates).
-- Металл — ₽/пог.м, работа сварщика и расходники — ₽/пог.м металла, фурнитура — ₽/шт.
create table if not exists loft_rates (
  key text primary key,
  label text not null,
  unit text not null,
  value numeric not null default 0,
  sort int not null default 100
);

alter table loft_rates enable row level security;
drop policy if exists "lr_auth_all" on loft_rates;
create policy "lr_auth_all" on loft_rates
  for all to authenticated using (true) with check (true);

insert into loft_rates (key, label, unit, value, sort) values
  ('profile_40x20',  'Труба профильная 40×20 (коробка/полотно)', '₽/пог.м', 250, 10),
  ('profile_shtapik','Штапик — труба 15×15',                     '₽/пог.м', 120, 20),
  ('strip_pritvor',  'Притвор — полоса 30×2',                    '₽/пог.м', 90,  30),
  ('seal',           'Уплотнитель',                              '₽/пог.м', 70,  40),
  ('hinge',          'Петля приварная',                          '₽/шт',    400, 50),
  ('handle_set',     'Ручка (комплект уголков 25×25)',           '₽/створка', 600, 60),
  ('consumables_m',  'Расходники (диски, проволока, грунт, метизы)', '₽/пог.м металла', 80, 70),
  ('weld_m',         'Работа сварщика (резка, сварка, зачистка)', '₽/пог.м металла', 450, 80),
  ('paint_m',        'Покраска порошковая',                      '₽/пог.м металла', 220, 90),
  ('paint_min',      'Покраска — минимум за заказ',              '₽',       8000, 91),
  ('glazing_glass',  'Остекление и сборка',                      '₽/стекло', 700, 100),
  ('glass_waste_pct','Отход стекла',                             '%',       10,  110)
on conflict (key) do nothing;
