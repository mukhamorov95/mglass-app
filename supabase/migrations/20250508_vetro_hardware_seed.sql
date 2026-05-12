-- ═══════════════════════════════════════════════════════════════════
-- Ветро: каталог фурнитуры душевых. Цены с сайта, скидка 0% (задать позже)
-- ═══════════════════════════════════════════════════════════════════

-- 1. Таблицы
CREATE TABLE IF NOT EXISTS public.shower_catalog_items (
  id           bigserial   primary key,
  name         text        not null,
  article      text        not null default '',
  category     text        not null,
  unit         text        not null default 'шт',
  whip_length  int,
  shower_types text[]      not null default '{}',
  photo_url    text        not null default '',
  url          text        not null default '',
  comment      text        not null default '',
  active       boolean     not null default true,
  created_at   timestamptz not null default now()
);

CREATE TABLE IF NOT EXISTS public.shower_catalog_prices (
  id               bigserial   primary key,
  item_id          bigint      not null references public.shower_catalog_items(id) on delete cascade,
  supplier_id      int         not null references public.shower_hw_suppliers(id),
  color_id         int         not null references public.shower_hw_colors(id),
  website_price    numeric     not null default 0,
  discount_percent numeric     not null default 0,
  cost_price       numeric     not null default 0,
  vat_included     boolean     not null default false,
  updated_at       timestamptz not null default now(),
  unique (item_id, supplier_id, color_id)
);

-- 2. Цвета Ветро
INSERT INTO public.shower_hw_colors (name, sort_order) VALUES
  ('Pss',                  10),
  ('Sss (Brushed Nickel)', 11),
  ('Black',                12),
  ('Bronze',               13),
  ('White',                14),
  ('Gun Metal',            15),
  ('Gold',                 16),
  ('BrGold',               17),
  ('Polish Rose gold',     18),
  ('BrRose gold',          19),
  ('Crystal',              20)
ON CONFLICT (name) DO NOTHING;

-- 3. Поставщик
INSERT INTO public.shower_hw_suppliers (name) VALUES ('Ветро')
ON CONFLICT (name) DO NOTHING;

-- 4. Товары и цены
DO $$
DECLARE
  v_sup int;
  v_pss int; v_sss int; v_blk int; v_bro int; v_wht int;
  v_gm  int; v_gld int; v_brg int; v_prs int; v_brr int; v_cry int;
  v_id  bigint;
BEGIN
  SELECT id INTO v_sup FROM public.shower_hw_suppliers WHERE name = 'Ветро';
  SELECT id INTO v_pss FROM public.shower_hw_colors WHERE name = 'Pss';
  SELECT id INTO v_sss FROM public.shower_hw_colors WHERE name = 'Sss (Brushed Nickel)';
  SELECT id INTO v_blk FROM public.shower_hw_colors WHERE name = 'Black';
  SELECT id INTO v_bro FROM public.shower_hw_colors WHERE name = 'Bronze';
  SELECT id INTO v_wht FROM public.shower_hw_colors WHERE name = 'White';
  SELECT id INTO v_gm  FROM public.shower_hw_colors WHERE name = 'Gun Metal';
  SELECT id INTO v_gld FROM public.shower_hw_colors WHERE name = 'Gold';
  SELECT id INTO v_brg FROM public.shower_hw_colors WHERE name = 'BrGold';
  SELECT id INTO v_prs FROM public.shower_hw_colors WHERE name = 'Polish Rose gold';
  SELECT id INTO v_brr FROM public.shower_hw_colors WHERE name = 'BrRose gold';
  SELECT id INTO v_cry FROM public.shower_hw_colors WHERE name = 'Crystal';

  -- ── ПРОФИЛИ ──────────────────────────────────────────────────────

  INSERT INTO public.shower_catalog_items (name, article, category, unit, shower_types)
    VALUES ('П-образный профиль для стекла 8 мм (3м)', 'Pr-002', 'профили', 'хлыст', ARRAY['universal'])
    RETURNING id INTO v_id;
  INSERT INTO public.shower_catalog_prices (item_id, supplier_id, color_id, website_price, discount_percent, cost_price) VALUES
    (v_id,v_sup,v_pss, 2986,0,2986),(v_id,v_sup,v_sss, 3921,0,3921),(v_id,v_sup,v_blk, 2640,0,2640),
    (v_id,v_sup,v_bro, 3055,0,3055),(v_id,v_sup,v_wht, 2770,0,2770),(v_id,v_sup,v_gm,  3186,0,3186),
    (v_id,v_sup,v_gld, 3051,0,3051),(v_id,v_sup,v_brg, 3180,0,3180),(v_id,v_sup,v_prs, 3085,0,3085),
    (v_id,v_sup,v_brr, 3180,0,3180);

  INSERT INTO public.shower_catalog_items (name, article, category, unit, shower_types)
    VALUES ('Заглушка для порога (1м)', 'ПР-004-1м', 'профили', 'шт', ARRAY['universal'])
    RETURNING id INTO v_id;
  INSERT INTO public.shower_catalog_prices (item_id, supplier_id, color_id, website_price, discount_percent, cost_price) VALUES
    (v_id,v_sup,v_pss, 604,0,604),(v_id,v_sup,v_sss, 734,0,734),(v_id,v_sup,v_blk, 734,0,734),
    (v_id,v_sup,v_bro, 877,0,877),(v_id,v_sup,v_wht, 940,0,940),(v_id,v_sup,v_gm,  750,0,750),
    (v_id,v_sup,v_gld, 734,0,734),(v_id,v_sup,v_brg, 940,0,940),(v_id,v_sup,v_prs, 940,0,940),
    (v_id,v_sup,v_brr, 940,0,940);

  INSERT INTO public.shower_catalog_items (name, article, category, unit, shower_types)
    VALUES ('Заглушка для порога (1.5м)', 'ПР-004-1.5м', 'профили', 'шт', ARRAY['universal'])
    RETURNING id INTO v_id;
  INSERT INTO public.shower_catalog_prices (item_id, supplier_id, color_id, website_price, discount_percent, cost_price) VALUES
    (v_id,v_sup,v_pss, 894,0,894),(v_id,v_sup,v_blk, 873,0,873),(v_id,v_sup,v_bro, 1002,0,1002),
    (v_id,v_sup,v_gm,  877,0,877),(v_id,v_sup,v_brg, 1002,0,1002);

  INSERT INTO public.shower_catalog_items (name, article, category, unit, shower_types)
    VALUES ('Заглушка для порога (3м)', 'ПР-004-3м', 'профили', 'шт', ARRAY['universal'])
    RETURNING id INTO v_id;
  INSERT INTO public.shower_catalog_prices (item_id, supplier_id, color_id, website_price, discount_percent, cost_price) VALUES
    (v_id,v_sup,v_pss, 1786,0,1786),(v_id,v_sup,v_blk, 1745,0,1745),(v_id,v_sup,v_bro, 2002,0,2002),
    (v_id,v_sup,v_gm,  1753,0,1753),(v_id,v_sup,v_gld, 1847,0,1847),(v_id,v_sup,v_brg, 2002,0,2002);

  -- ── ШТАНГИ ───────────────────────────────────────────────────────

  INSERT INTO public.shower_catalog_items (name, article, category, unit, shower_types)
    VALUES ('Штанга для душевых 30x10, 2м', 'Ш-002/2м', 'штанги', 'хлыст', ARRAY['universal'])
    RETURNING id INTO v_id;
  INSERT INTO public.shower_catalog_prices (item_id, supplier_id, color_id, website_price, discount_percent, cost_price) VALUES
    (v_id,v_sup,v_pss, 2721,0,2721),(v_id,v_sup,v_sss, 2721,0,2721),(v_id,v_sup,v_blk, 3798,0,3798),
    (v_id,v_sup,v_bro, 4310,0,4310),(v_id,v_sup,v_wht, 3798,0,3798),(v_id,v_sup,v_gm,  4617,0,4617),
    (v_id,v_sup,v_gld, 4431,0,4431),(v_id,v_sup,v_prs, 4497,0,4497);

  INSERT INTO public.shower_catalog_items (name, article, category, unit, shower_types)
    VALUES ('Штанга для душевых 30x10 Premium, 2м', 'Ш-002/Premium-2м', 'штанги', 'хлыст', ARRAY['universal'])
    RETURNING id INTO v_id;
  INSERT INTO public.shower_catalog_prices (item_id, supplier_id, color_id, website_price, discount_percent, cost_price) VALUES
    (v_id,v_sup,v_pss, 4558,0,4558),(v_id,v_sup,v_gm, 9998,0,9998),(v_id,v_sup,v_brg, 7155,0,7155);

  INSERT INTO public.shower_catalog_items (name, article, category, unit, shower_types)
    VALUES ('Штанга для душевых 30x10, 1.5м', 'Ш-002/1.5м', 'штанги', 'хлыст', ARRAY['universal'])
    RETURNING id INTO v_id;
  INSERT INTO public.shower_catalog_prices (item_id, supplier_id, color_id, website_price, discount_percent, cost_price) VALUES
    (v_id,v_sup,v_bro, 3284,0,3284),(v_id,v_sup,v_gm, 3417,0,3417),
    (v_id,v_sup,v_gld, 3425,0,3425),(v_id,v_sup,v_brg, 5125,0,5125);

  INSERT INTO public.shower_catalog_items (name, article, category, unit, shower_types)
    VALUES ('Штанга для душевых 30x10, 3м', 'Ш-002/3м', 'штанги', 'хлыст', ARRAY['universal'])
    RETURNING id INTO v_id;
  INSERT INTO public.shower_catalog_prices (item_id, supplier_id, color_id, website_price, discount_percent, cost_price) VALUES
    (v_id,v_sup,v_pss, 4081,0,4081),(v_id,v_sup,v_sss, 4081,0,4081),(v_id,v_sup,v_blk, 5713,0,5713),
    (v_id,v_sup,v_bro, 6362,0,6362),(v_id,v_sup,v_gm,  6645,0,6645),(v_id,v_sup,v_gld, 9650,0,9650);

  -- ── КРЕПЛЕНИЯ ────────────────────────────────────────────────────

  INSERT INTO public.shower_catalog_items (name, article, category, unit, shower_types)
    VALUES ('Крепление штанги 30x10 к стене', 'КП-002', 'крепления', 'шт', ARRAY['universal'])
    RETURNING id INTO v_id;
  INSERT INTO public.shower_catalog_prices (item_id, supplier_id, color_id, website_price, discount_percent, cost_price) VALUES
    (v_id,v_sup,v_pss, 810,0,810),(v_id,v_sup,v_sss, 810,0,810),(v_id,v_sup,v_blk, 864,0,864),
    (v_id,v_sup,v_bro, 685,0,685),(v_id,v_sup,v_wht, 720,0,720),
    (v_id,v_sup,v_gld, 1097,0,1097),(v_id,v_sup,v_brg, 683,0,683);

  INSERT INTO public.shower_catalog_items (name, article, category, unit, shower_types)
    VALUES ('Угловое соединение 90° для штанг 30x10', 'КП-003', 'крепления', 'шт', ARRAY['universal'])
    RETURNING id INTO v_id;
  INSERT INTO public.shower_catalog_prices (item_id, supplier_id, color_id, website_price, discount_percent, cost_price) VALUES
    (v_id,v_sup,v_pss, 1026,0,1026),(v_id,v_sup,v_sss, 766,0,766),(v_id,v_sup,v_blk, 1078,0,1078),
    (v_id,v_sup,v_bro, 1066,0,1066),(v_id,v_sup,v_wht, 984,0,984),(v_id,v_sup,v_gm,  2028,0,2028),
    (v_id,v_sup,v_gld, 1066,0,1066),(v_id,v_sup,v_brg, 1017,0,1017);

  INSERT INTO public.shower_catalog_items (name, article, category, unit, shower_types)
    VALUES ('Крепление штанги 30x10 к стеклу (торцевое)', 'КП-001-торц', 'крепления', 'шт', ARRAY['universal'])
    RETURNING id INTO v_id;
  INSERT INTO public.shower_catalog_prices (item_id, supplier_id, color_id, website_price, discount_percent, cost_price) VALUES
    (v_id,v_sup,v_pss, 967,0,967),(v_id,v_sup,v_blk, 972,0,972),(v_id,v_sup,v_bro, 1133,0,1133),
    (v_id,v_sup,v_wht, 951,0,951),(v_id,v_sup,v_gm,  862,0,862),
    (v_id,v_sup,v_gld, 1152,0,1152),(v_id,v_sup,v_brg, 809,0,809);

  INSERT INTO public.shower_catalog_items (name, article, category, unit, shower_types)
    VALUES ('Крепление стекла к штанге 30x10 (горизонтальное)', 'КП-006', 'крепления', 'шт', ARRAY['universal'])
    RETURNING id INTO v_id;
  INSERT INTO public.shower_catalog_prices (item_id, supplier_id, color_id, website_price, discount_percent, cost_price) VALUES
    (v_id,v_sup,v_pss, 1134,0,1134),(v_id,v_sup,v_sss, 1026,0,1026),(v_id,v_sup,v_blk, 1232,0,1232),
    (v_id,v_sup,v_bro, 1262,0,1262),(v_id,v_sup,v_wht, 1524,0,1524),
    (v_id,v_sup,v_gld, 1262,0,1262),(v_id,v_sup,v_brg, 1008,0,1008);

  INSERT INTO public.shower_catalog_items (name, article, category, unit, shower_types)
    VALUES ('Крепление штанги 30x10 к стеклу', 'КП-001', 'крепления', 'шт', ARRAY['universal'])
    RETURNING id INTO v_id;
  INSERT INTO public.shower_catalog_prices (item_id, supplier_id, color_id, website_price, discount_percent, cost_price) VALUES
    (v_id,v_sup,v_pss, 1090,0,1090),(v_id,v_sup,v_sss, 868,0,868),(v_id,v_sup,v_blk, 1242,0,1242),
    (v_id,v_sup,v_bro, 1189,0,1189),(v_id,v_sup,v_wht, 1529,0,1529),
    (v_id,v_sup,v_gld, 1190,0,1190),(v_id,v_sup,v_brg, 992,0,992);

  INSERT INTO public.shower_catalog_items (name, article, category, unit, shower_types)
    VALUES ('Роликовая каретка для штанг 30x10', 'КП-005', 'крепления', 'шт', ARRAY['sliding'])
    RETURNING id INTO v_id;
  INSERT INTO public.shower_catalog_prices (item_id, supplier_id, color_id, website_price, discount_percent, cost_price) VALUES
    (v_id,v_sup,v_pss, 1059,0,1059),(v_id,v_sup,v_blk, 1134,0,1134),(v_id,v_sup,v_wht, 1667,0,1667),
    (v_id,v_sup,v_gm,  2062,0,2062),(v_id,v_sup,v_gld, 1269,0,1269);

  -- ── МЕХАНИЗМЫ ────────────────────────────────────────────────────

  INSERT INTO public.shower_catalog_items (name, article, category, unit, shower_types)
    VALUES ('Раздвижная система (Hip System) 30x10', 'РД-001', 'механизмы', 'компл', ARRAY['sliding'])
    RETURNING id INTO v_id;
  INSERT INTO public.shower_catalog_prices (item_id, supplier_id, color_id, website_price, discount_percent, cost_price) VALUES
    (v_id,v_sup,v_pss, 7809,0,7809),(v_id,v_sup,v_sss, 7809,0,7809),(v_id,v_sup,v_blk, 5994,0,5994),
    (v_id,v_sup,v_bro, 9264,0,9264),(v_id,v_sup,v_wht, 8632,0,8632),(v_id,v_sup,v_gm,  9158,0,9158),
    (v_id,v_sup,v_gld, 9195,0,9195),(v_id,v_sup,v_brg, 8859,0,8859),(v_id,v_sup,v_prs, 8632,0,8632);

  -- ── ПЕТЛИ ────────────────────────────────────────────────────────

  INSERT INTO public.shower_catalog_items (name, article, category, unit, shower_types)
    VALUES ('Петля стена-стекло 90° Dessau-101', 'Dessau-101', 'петли', 'шт', ARRAY['swing'])
    RETURNING id INTO v_id;
  INSERT INTO public.shower_catalog_prices (item_id, supplier_id, color_id, website_price, discount_percent, cost_price) VALUES
    (v_id,v_sup,v_pss, 7029,0,7029),(v_id,v_sup,v_sss, 7147,0,7147),(v_id,v_sup,v_blk, 9125,0,9125),
    (v_id,v_sup,v_bro, 8222,0,8222),(v_id,v_sup,v_wht, 9139,0,9139),(v_id,v_sup,v_gm,  8245,0,8245),
    (v_id,v_sup,v_gld, 7692,0,7692),(v_id,v_sup,v_brg, 8222,0,8222),(v_id,v_sup,v_prs, 8222,0,8222),
    (v_id,v_sup,v_brr, 8989,0,8989);

  INSERT INTO public.shower_catalog_items (name, article, category, unit, shower_types)
    VALUES ('Петля стекло-стекло 180° Dessau-103', 'Dessau-103', 'петли', 'шт', ARRAY['swing'])
    RETURNING id INTO v_id;
  INSERT INTO public.shower_catalog_prices (item_id, supplier_id, color_id, website_price, discount_percent, cost_price) VALUES
    (v_id,v_sup,v_pss,  7381,0,7381),(v_id,v_sup,v_sss,  9303,0,9303),(v_id,v_sup,v_blk,  9303,0,9303),
    (v_id,v_sup,v_bro,  9426,0,9426),(v_id,v_sup,v_wht, 10415,0,10415),(v_id,v_sup,v_gm,   9308,0,9308),
    (v_id,v_sup,v_gld, 10052,0,10052),(v_id,v_sup,v_brg, 10306,0,10306),(v_id,v_sup,v_prs, 10258,0,10258),
    (v_id,v_sup,v_brr, 10415,0,10415);

  INSERT INTO public.shower_catalog_items (name, article, category, unit, shower_types)
    VALUES ('Петля стекло-стекло 135° Dessau-135', 'Dessau-135', 'петли', 'шт', ARRAY['swing'])
    RETURNING id INTO v_id;
  INSERT INTO public.shower_catalog_prices (item_id, supplier_id, color_id, website_price, discount_percent, cost_price) VALUES
    (v_id,v_sup,v_pss, 8204,0,8204),(v_id,v_sup,v_sss, 8397,0,8397),(v_id,v_sup,v_blk, 9591,0,9591),
    (v_id,v_sup,v_brg, 9591,0,9591),(v_id,v_sup,v_prs, 9591,0,9591);

  INSERT INTO public.shower_catalog_items (name, article, category, unit, shower_types)
    VALUES ('Петля стекло-стекло 90-180° Miami-701N', 'Miami-701N', 'петли', 'шт', ARRAY['swing'])
    RETURNING id INTO v_id;
  INSERT INTO public.shower_catalog_prices (item_id, supplier_id, color_id, website_price, discount_percent, cost_price) VALUES
    (v_id,v_sup,v_pss, 5298,0,5298),(v_id,v_sup,v_sss, 5236,0,5236),(v_id,v_sup,v_blk, 6506,0,6506),
    (v_id,v_sup,v_bro, 7288,0,7288),(v_id,v_sup,v_wht, 7754,0,7754),(v_id,v_sup,v_gm,  7065,0,7065),
    (v_id,v_sup,v_gld, 8028,0,8028),(v_id,v_sup,v_prs, 7754,0,7754);

  INSERT INTO public.shower_catalog_items (name, article, category, unit, shower_types)
    VALUES ('Петля стекло-стекло 90-180° Miami-706N', 'Miami-706N', 'петли', 'шт', ARRAY['swing'])
    RETURNING id INTO v_id;
  INSERT INTO public.shower_catalog_prices (item_id, supplier_id, color_id, website_price, discount_percent, cost_price) VALUES
    (v_id,v_sup,v_pss,  7120,0,7120),(v_id,v_sup,v_sss,  6997,0,6997),(v_id,v_sup,v_blk,  8856,0,8856),
    (v_id,v_sup,v_bro, 10521,0,10521),(v_id,v_sup,v_wht, 10360,0,10360),(v_id,v_sup,v_gm,   9501,0,9501),
    (v_id,v_sup,v_gld,  9824,0,9824),(v_id,v_sup,v_brg, 10767,0,10767),(v_id,v_sup,v_prs, 10360,0,10360),
    (v_id,v_sup,v_brr, 10360,0,10360);

  INSERT INTO public.shower_catalog_items (name, article, category, unit, shower_types)
    VALUES ('Петля стекло-стекло 135-180° Miami-709N', 'Miami-709N', 'петли', 'шт', ARRAY['swing'])
    RETURNING id INTO v_id;
  INSERT INTO public.shower_catalog_prices (item_id, supplier_id, color_id, website_price, discount_percent, cost_price) VALUES
    (v_id,v_sup,v_pss,  7286,0,7286),(v_id,v_sup,v_sss,  6673,0,6673),(v_id,v_sup,v_blk,  9229,0,9229),
    (v_id,v_sup,v_bro,  9727,0,9727),(v_id,v_sup,v_wht, 10148,0,10148),(v_id,v_sup,v_gm,   9201,0,9201),
    (v_id,v_sup,v_gld,  9106,0,9106),(v_id,v_sup,v_brg,  9746,0,9746),(v_id,v_sup,v_prs, 10148,0,10148),
    (v_id,v_sup,v_brr, 10148,0,10148);

  INSERT INTO public.shower_catalog_items (name, article, category, unit, shower_types)
    VALUES ('Петля стекло-стекло 135-180° Balge-002', 'Balge-002', 'петли', 'шт', ARRAY['swing'])
    RETURNING id INTO v_id;
  INSERT INTO public.shower_catalog_prices (item_id, supplier_id, color_id, website_price, discount_percent, cost_price) VALUES
    (v_id,v_sup,v_pss, 3953,0,3953),(v_id,v_sup,v_sss, 4919,0,4919),(v_id,v_sup,v_blk, 6211,0,6211),
    (v_id,v_sup,v_bro, 4535,0,4535),(v_id,v_sup,v_wht, 5680,0,5680),(v_id,v_sup,v_gm,  5693,0,5693),
    (v_id,v_sup,v_gld, 4535,0,4535),(v_id,v_sup,v_brg, 5897,0,5897),(v_id,v_sup,v_prs, 5680,0,5680),
    (v_id,v_sup,v_brr, 5680,0,5680);

  INSERT INTO public.shower_catalog_items (name, article, category, unit, shower_types)
    VALUES ('Петля стекло-стекло 135-180° Balge-004', 'Balge-004', 'петли', 'шт', ARRAY['swing'])
    RETURNING id INTO v_id;
  INSERT INTO public.shower_catalog_prices (item_id, supplier_id, color_id, website_price, discount_percent, cost_price) VALUES
    (v_id,v_sup,v_pss, 4606,0,4606),(v_id,v_sup,v_sss, 5859,0,5859),(v_id,v_sup,v_blk, 5084,0,5084),
    (v_id,v_sup,v_bro, 5084,0,5084),(v_id,v_sup,v_wht, 6081,0,6081),(v_id,v_sup,v_gm,  6433,0,6433),
    (v_id,v_sup,v_gld, 5348,0,5348),(v_id,v_sup,v_brg, 6436,0,6436),(v_id,v_sup,v_prs, 6606,0,6606),
    (v_id,v_sup,v_brr, 6081,0,6081);

  INSERT INTO public.shower_catalog_items (name, article, category, unit, shower_types)
    VALUES ('Петля стена-стекло New York-331', 'New York-331', 'петли', 'шт', ARRAY['swing'])
    RETURNING id INTO v_id;
  INSERT INTO public.shower_catalog_prices (item_id, supplier_id, color_id, website_price, discount_percent, cost_price) VALUES
    (v_id,v_sup,v_pss, 5301,0,5301),(v_id,v_sup,v_blk, 6025,0,6025),
    (v_id,v_sup,v_bro, 6104,0,6104),(v_id,v_sup,v_gld, 6104,0,6104);

  INSERT INTO public.shower_catalog_items (name, article, category, unit, shower_types)
    VALUES ('Петля стена-стекло 135-180° New York-332', 'New York-332', 'петли', 'шт', ARRAY['swing'])
    RETURNING id INTO v_id;
  INSERT INTO public.shower_catalog_prices (item_id, supplier_id, color_id, website_price, discount_percent, cost_price) VALUES
    (v_id,v_sup,v_pss, 7050,0,7050),(v_id,v_sup,v_blk, 7977,0,7977),
    (v_id,v_sup,v_bro, 8089,0,8089),(v_id,v_sup,v_gm,  8170,0,8170);

  -- ── УПЛОТНИТЕЛИ ──────────────────────────────────────────────────

  INSERT INTO public.shower_catalog_items (name, article, category, unit, shower_types)
    VALUES ('Уплотнительный профиль 2.2НИЗ (UT-10-02)', 'UT-10-02-НИЗ', 'уплотнители', 'шт', ARRAY['universal'])
    RETURNING id INTO v_id;
  INSERT INTO public.shower_catalog_prices (item_id, supplier_id, color_id, website_price, discount_percent, cost_price) VALUES
    (v_id,v_sup,v_cry, 646,0,646),(v_id,v_sup,v_blk, 668,0,668);

  INSERT INTO public.shower_catalog_items (name, article, category, unit, shower_types)
    VALUES ('Уплотнительный профиль 2.2Ч', 'UT-10-02-Ч', 'уплотнители', 'шт', ARRAY['universal'])
    RETURNING id INTO v_id;

  INSERT INTO public.shower_catalog_items (name, article, category, unit, shower_types)
    VALUES ('Уплотнительный профиль 2.2А', 'UT-10-02-А', 'уплотнители', 'шт', ARRAY['universal'])
    RETURNING id INTO v_id;

  INSERT INTO public.shower_catalog_items (name, article, category, unit, shower_types)
    VALUES ('Магнитный уплотнитель 90° 2.2МАГНИТ', 'UT-МАГНИТ-90', 'уплотнители', 'компл', ARRAY['swing'])
    RETURNING id INTO v_id;
  INSERT INTO public.shower_catalog_prices (item_id, supplier_id, color_id, website_price, discount_percent, cost_price) VALUES
    (v_id,v_sup,v_cry, 2010,0,2010);

  INSERT INTO public.shower_catalog_items (name, article, category, unit, shower_types)
    VALUES ('Магнитный уплотнитель 180° 2.2МАГНИТ', 'UT-МАГНИТ-180', 'уплотнители', 'компл', ARRAY['swing'])
    RETURNING id INTO v_id;

END $$;
