-- Pricing formula settings: financial logic for calculators
CREATE TABLE IF NOT EXISTS pricing_formula (
  id          serial PRIMARY KEY,
  section     text NOT NULL,        -- 'glass' | 'mirror' | 'b2b'
  param_key   text NOT NULL,
  param_name  text NOT NULL,
  value       numeric(10,2) NOT NULL DEFAULT 0,
  unit        text NOT NULL DEFAULT '%',   -- '%' | 'коэф' | '₽'
  description text,
  sort_order  int NOT NULL DEFAULT 0,
  updated_at  timestamptz DEFAULT now(),
  UNIQUE (section, param_key)
);

INSERT INTO pricing_formula (section, param_key, param_name, value, unit, description, sort_order) VALUES
  -- Стекло
  ('glass', 'purchase_vat',        'НДС закупки стекла',          20,   '%',    'НДС, уплаченный поставщику при покупке стекла. Включён в себестоимость, но НЕ является прибылью.',                             1),
  ('glass', 'tempering_vat',       'НДС закалки',                 20,   '%',    'НДС на услугу закалки. Принимается к зачёту.',                                                                                  2),
  ('glass', 'opex',                'Операционные расходы',        11,   '%',    'ФОТ, аренда, реклама, налог УСН — берётся от продажной цены в формуле: цена = себестоимость ÷ (1 − опex − маржа).',            3),
  ('glass', 'base_margin',         'Базовая маржа',               40,   '%',    'Целевая маржа B2C калькуляторов. Маржа = чистая прибыль ÷ продажная цена.',                                                    4),
  ('glass', 'recommended_margin',  'Рекомендуемая маржа',         35,   '%',    'Нижний "зелёный" порог. Ниже — жёлтый. Ниже минимума — красный.',                                                              5),
  ('glass', 'min_margin',          'Минимальная маржа',           25,   '%',    'Нельзя продавать ниже. Менеджер видит красный флаг.',                                                                           6),

  -- Зеркала
  ('mirror', 'purchase_vat',       'НДС закупки зеркала',         20,   '%',    'НДС при закупке зеркального полотна у поставщика.',                                                                             1),
  ('mirror', 'opex',               'Операционные расходы',        11,   '%',    'Аналог стеклу: берётся от продажной цены в формуле.',                                                                           2),
  ('mirror', 'base_margin',        'Базовая маржа',               40,   '%',    'Целевая маржа для зеркальных изделий.',                                                                                         3),
  ('mirror', 'recommended_margin', 'Рекомендуемая маржа',         35,   '%',    'Нижняя граница "хорошей" маржи.',                                                                                               4),
  ('mirror', 'min_margin',         'Минимальная маржа',           25,   '%',    'Минимально допустимая маржа.',                                                                                                  5),

  -- B2B
  ('b2b',   'vat',                 'НДС',                         20,   '%',    'НДС на реализацию. Входной НДС с закупки зачитывается.',                                                                        1),
  ('b2b',   'margin',              'Стандартная маржа B2B',       30,   '%',    'Целевая наценка для оптовых клиентов.',                                                                                          2),
  ('b2b',   'min_margin',          'Минимальная маржа B2B',       15,   '%',    'Нижняя граница для B2B.',                                                                                                       3),
  ('b2b',   'extra_coefficient',   'Доп. коэффициент',             1.0, 'коэф', 'Множитель при особых условиях (срочность, сложность). 1.0 = без надбавки.',                                                    4)

ON CONFLICT (section, param_key) DO NOTHING;
