-- Company roles catalog (seeded, static)
CREATE TABLE IF NOT EXISTS company_roles (
  id          text PRIMARY KEY,
  title       text NOT NULL,
  level       int  NOT NULL DEFAULT 1,
  sort_order  int  NOT NULL DEFAULT 0
);

INSERT INTO company_roles (id, title, level, sort_order) VALUES
  ('owner',          'Собственник',               0,  1),
  ('ceo',            'Генеральный директор',       1,  2),
  ('cfo',            'Финансовый директор',        1,  3),
  ('sales_lead',     'Руководитель продаж',        1,  4),
  ('manager',        'Менеджер продаж',            2,  5),
  ('production_lead','Руководитель производства',  1,  6),
  ('production',     'Производственник',           2,  7),
  ('install_lead',   'Руководитель монтажей',      1,  8),
  ('installer',      'Монтажник',                  2,  9),
  ('buyer',          'Закупщик',                   1, 10),
  ('logist',         'Логист',                     1, 11),
  ('engineer',       'Конструктор',                1, 12),
  ('marketer',       'Маркетолог',                 1, 13),
  ('ai_manager',     'AI/Automation менеджер',     1, 14),
  ('content',        'Контент-менеджер',           2, 15),
  ('hr',             'HR / Найм',                  1, 16),
  ('platform_admin', 'Администратор платформы',    1, 17)
ON CONFLICT DO NOTHING;

-- Role assignments: people assigned to roles
CREATE TABLE IF NOT EXISTS role_assignments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id     text NOT NULL REFERENCES company_roles(id) ON DELETE CASCADE,
  first_name  text NOT NULL,
  last_name   text,
  phone       text,
  telegram    text,
  email       text,
  notes       text,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Seed current team
INSERT INTO role_assignments (role_id, first_name, last_name, notes) VALUES
  ('owner',          'Владислав', 'Мухоморов', 'Собственник компании MGlass'),
  ('ceo',            'Владислав', 'Мухоморов', 'Совмещает с ролью собственника'),
  ('cfo',            'Владислав', 'Мухоморов', 'Совмещает с ролью собственника'),
  ('sales_lead',     'Владислав', 'Мухоморов', 'Совмещает с ролью собственника'),
  ('install_lead',   'Дмитрий',   null,         'Руководитель монтажей'),
  ('production_lead','Дмитрий',   null,         'Начальник производства'),
  ('logist',         'Вера',      null,         'Логист и закупки'),
  ('buyer',          'Вера',      null,         'Закупки и логистика')
ON CONFLICT DO NOTHING;
