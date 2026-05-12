-- Add tempering cost params per thickness to pricing_formula
INSERT INTO pricing_formula (section, param_key, param_name, value, unit, description, sort_order)
VALUES
  ('glass', 'tempering_t4',  'Закалка 4мм',   300, '₽/м²', 'Стоимость услуги закалки стекла 4мм за 1 м² биллинговой площади (площадь с учётом расхода).',  7),
  ('glass', 'tempering_t5',  'Закалка 5мм',   350, '₽/м²', 'Стоимость услуги закалки стекла 5мм за 1 м² биллинговой площади.',  8),
  ('glass', 'tempering_t6',  'Закалка 6мм',   400, '₽/м²', 'Стоимость услуги закалки стекла 6мм за 1 м² биллинговой площади.',  9),
  ('glass', 'tempering_t8',  'Закалка 8мм',   500, '₽/м²', 'Стоимость услуги закалки стекла 8мм за 1 м² биллинговой площади.', 10),
  ('glass', 'tempering_t10', 'Закалка 10мм',  600, '₽/м²', 'Стоимость услуги закалки стекла 10мм за 1 м² биллинговой площади.', 11)
ON CONFLICT (section, param_key) DO NOTHING;
