-- Справочник авто-надбавок за габариты/сложность изделия.
--
-- Зачем: крупные и сложные изделия честно дороже (два человека носят, дольше
-- полируют/крутят, сложный рез). Раньше это закрывалось ручными услугами
-- «Прямолинейное от 3000 мм +30%» / «Криволинейное от 3000 мм +100%» — грубо и
-- только от 3 метров. Владелец: «полтора метра на два — уже широкая деталь».
--
-- Модель: правило = ступень по одной оси (длинная сторона / короткая сторона /
-- сложность формы) с процентной надбавкой. Надбавка применяется АВТОМАТИЧЕСКИ по
-- габаритам позиции, но менеджер может снять её вручную. В КП пишется отдельной
-- строкой («Крупногабарит: высота 2400–2600 мм (+10%)»). Проценты складываются.
--
-- Ось:
--   length — длинная сторона детали  = max(width, height)  («высота/длина»)
--   width  — короткая сторона детали = min(width, height)  («ширина»)
--   shape  — сложность формы, только для криволинейных (shape='curved'),
--            ключ = длинная сторона (габарит)
--
-- Проценты — СТАРТОВЫЕ значения (мировая практика + слова владельца), редактируются
-- в /admin/b2b-surcharges. Процент считается от цены изделия с НДС (как type=percent
-- в b2b_services), себестоимость надбавки = 0 (компенсирует уже оплаченный окладами
-- труд/капасити, не закупку) — та же модель, что у «Непрямоугольной формы 30%».

create table if not exists b2b_surcharge_rules (
  id                bigint generated always as identity primary key,
  axis              text not null check (axis in ('length','width','shape')),
  min_mm            numeric not null default 0,        -- включительно
  max_mm            numeric,                            -- исключительно; null = ∞
  surcharge_percent numeric not null,
  label             text not null,                      -- как печатается в КП
  shape_filter      text check (shape_filter in ('curved')),  -- null = любая форма
  active            boolean not null default true,
  sort_order        integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table b2b_surcharge_rules is
  'Авто-надбавки за габариты/сложность B2B-изделия. axis=length→max(w,h), width→min(w,h), shape→только curved. Процент от цены с НДС, применяется в калькуляторе, печатается строкой в КП.';

create index if not exists idx_surcharge_rules_active
  on b2b_surcharge_rules (active, axis, sort_order);

alter table b2b_surcharge_rules enable row level security;

-- Тот же паттерн, что у b2b_services (справочник, читает браузер; запись гейтится в UI).
drop policy if exists auth_read on b2b_surcharge_rules;
create policy auth_read on b2b_surcharge_rules for select to authenticated using (true);
drop policy if exists auth_all on b2b_surcharge_rules;
create policy auth_all on b2b_surcharge_rules for all to authenticated using (true) with check (true);

-- ── Стартовые правила ───────────────────────────────────────────────────────
insert into b2b_surcharge_rules (axis, min_mm, max_mm, surcharge_percent, label, shape_filter, sort_order) values
  -- Длинная сторона (высота/длина)
  ('length', 2400, 2600, 10, 'Крупногабарит: высота 2400–2600 мм', null, 10),
  ('length', 2600, 2900, 20, 'Крупногабарит: высота 2600–2900 мм', null, 11),
  ('length', 2900, 3200, 35, 'Крупногабарит: высота 2900–3200 мм', null, 12),
  -- Короткая сторона (ширина)
  ('width',  1200, 1400, 10, 'Широкая деталь: ширина 1200–1400 мм', null, 20),
  ('width',  1400, 1600, 20, 'Широкая деталь: ширина 1400–1600 мм', null, 21),
  ('width',  1600, 2000, 30, 'Широкая деталь: ширина 1600–2000 мм', null, 22),
  ('width',  2000, null, 45, 'Широкая деталь: ширина свыше 2000 мм', null, 23),
  -- Сложность формы (только криволинейные), ключ — длинная сторона
  ('shape',  1000, 1500, 30, 'Сложная форма: габарит 1000–1500 мм', 'curved', 30),
  ('shape',  1500, null, 60, 'Сложная форма: габарит свыше 1500 мм', 'curved', 31)
on conflict do nothing;
