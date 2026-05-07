-- Sales bonus catalog
CREATE TABLE IF NOT EXISTS sales_bonuses (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  type        TEXT NOT NULL,
  value       TEXT,
  conditions  TEXT,
  active      BOOLEAN NOT NULL DEFAULT true,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE sales_bonuses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_all_bonuses" ON sales_bonuses
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

-- Curated sales scripts
CREATE TABLE IF NOT EXISTS sales_scripts (
  id           SERIAL PRIMARY KEY,
  category     TEXT NOT NULL,
  title        TEXT NOT NULL,
  trigger_desc TEXT,
  body         TEXT NOT NULL,
  is_featured  BOOLEAN NOT NULL DEFAULT false,
  active       BOOLEAN NOT NULL DEFAULT true,
  sort_order   INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE sales_scripts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_all_scripts" ON sales_scripts
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "manager_read_scripts" ON sales_scripts
  FOR SELECT USING (true);

-- AI response feedback
CREATE TABLE IF NOT EXISTS ai_sales_feedback (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id         TEXT,
  message_content TEXT NOT NULL,
  rating          TEXT NOT NULL CHECK (rating IN ('good', 'bad')),
  comment         TEXT,
  category        TEXT,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE ai_sales_feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_all_feedback" ON ai_sales_feedback
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "manager_insert_feedback" ON ai_sales_feedback
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Seed bonuses
INSERT INTO sales_bonuses (name, description, type, value, conditions, sort_order) VALUES
  ('Бесплатный замер',        'Выезд замерщика бесплатно',                          'free_measurement',      '0',      'При заказе от 30 000 ₽ или при явном сомнении клиента',     1),
  ('Бесплатная доставка',     'Доставка по Москве без доп. оплаты',                  'free_delivery',         '0',      'При заказе от 50 000 ₽ или для VIP-клиента',               2),
  ('Скидка на монтаж 10%',    'Десятипроцентная скидка на услугу монтажа',           'discount_installation', '10',     'При повторном заказе или крупной сделке',                  3),
  ('Плёнка безопасности',     'Защитная плёнка на стекло в подарок',                 'film',                  '0',      'Хороший аргумент для клиентов с детьми или безопасностью', 4),
  ('Upgrade фурнитуры',       'Улучшенная фурнитура за счёт компании',               'hw_upgrade',            '0',      'При заказе на сумму от 80 000 ₽',                          5),
  ('Премиум подсветка',       'LED-подсветка класса Premium без доп. стоимости',     'premium_lighting',      '0',      'Для зеркал при высоком среднем чеке',                      6),
  ('Скидка на 2-й заказ',     'Скидка 5% на следующий заказ при оплате сейчас',      'second_order',          '5',      'Для клиентов, планирующих несколько объектов',             7)
ON CONFLICT DO NOTHING;

-- Seed scripts
INSERT INTO sales_scripts (category, title, trigger_desc, body, is_featured, sort_order) VALUES
  ('objection_expensive',
   'Дорого — первый ответ',
   'Клиент говорит "дорого" или сравнивает с дешёвым предложением',
   E'Понимаю вас.\n\nДавайте разберём, из чего складывается цена — чтобы вы видели, за что платите.\n\nВ нашей душевой:\n• Закалённое стекло 8 мм — не треснет при ударе, безопасно\n• Фурнитура без коррозии — работает тихо и без люфта через 5 лет\n• Монтаж с гарантией — если что-то пойдёт не так, мы приедем\n\nДешёвые аналоги чаще всего: тонкое стекло, китайская фурнитура, и монтаж "на страх и риск".\n\nСкажите, а какое предложение вы смотрели? Я могу сравнить конкретно.',
   true, 1),

  ('objection_expensive',
   'Дорого — предложить альтернативу',
   'Клиент настаивает на цене, не реагирует на ценность',
   E'Хорошо, давайте найдём вариант, который вам подойдёт.\n\nЕсть несколько путей:\n1. Уменьшить размер — если возможно по планировке\n2. Выбрать бюджетную серию — алюминий + хром, базовая фурнитура\n3. Отказаться от монтажа — если у вас есть свои мастера\n\nЧто для вас важнее: уложиться в бюджет или получить конкретный результат?\nДавайте отталкиваться от этого.',
   false, 2),

  ('measurement_close',
   'Закрытие на замер — мягкий',
   'Клиент интересуется, но не принимает решение',
   E'Слушайте, самое точное, что мы можем сделать — это просто приехать и посмотреть.\n\nЗамер бесплатный, занимает 20–30 минут.\nПосле него у вас будет конкретная цифра — без "около" и "ориентировочно".\n\nЗавтра или послезавтра — как вам удобнее?',
   true, 1),

  ('measurement_close',
   'Закрытие на замер — уверенный',
   'Клиент уже понял, что хочет, но тянет',
   E'Окей, вы уже примерно понимаете, что хотите.\nОсталось только зафиксировать размеры и договориться.\n\nДавайте я запишу вас на замер — ничего не обязывает, просто сделаем точный расчёт на месте.\n\nКакой день удобен — будни или выходные?',
   true, 2),

  ('objection_compare',
   'Клиент сравнивает с конкурентом',
   'Клиент говорит "нашёл дешевле у другой компании"',
   E'Хорошо, что вы сравниваете — это правильно.\n\nНо давайте честно: при разных ценах почти всегда разное качество.\n\nПоделитесь, что за компания и что они предлагают? Я скажу честно, в чём разница.\n\nМы не боимся сравнения — просто хотим, чтобы вы сделали осознанный выбор.',
   true, 1),

  ('followup',
   'Follow-up — клиент думает',
   'Клиент сказал "подумаю" и пропал на 2–3 дня',
   E'Добрый день!\n\nЗнаю, что вы думаете над проектом.\n\nХотел уточнить: есть ли какой-то вопрос, который мешает принять решение? Может, нужна дополнительная информация или есть момент, который смущает?\n\nЯ здесь — готов помочь разобраться.',
   true, 1),

  ('followup',
   'Follow-up — после замера без ответа',
   'Замер состоялся, но клиент не выходит на связь 5+ дней',
   E'Добрый день!\n\nМы делали замер несколько дней назад — у меня готов точный расчёт.\n\nПоделиться? Там уже конкретные цифры под ваш объект.\n\nТакже хочу уточнить — у вас остались вопросы или есть что-то, что вас останавливает?',
   false, 2),

  ('upsell',
   'Апселл зеркала — предложить подсветку',
   'Клиент выбирает зеркало без подсветки',
   E'Кстати, пока считаем — хочу показать один момент.\n\nЗеркало с сенсорной LED-подсветкой стоит дороже примерно на 8–12 тысяч.\nНо это полностью меняет ощущение в ванной.\n\nПодсветка тёплая/холодная по касанию, регулируется яркость, диммер — как в хорошем отеле.\n\nМногие, кто брал без подсветки, потом жалеют. Стоит посмотреть хотя бы на фото?',
   true, 1),

  ('upsell',
   'Апселл душевой — предложить 10 мм стекло',
   'Клиент выбирает стандартное 8 мм стекло',
   E'Одна деталь, которую стоит учесть.\n\nСтекло 10 мм на ощупь и визуально совсем другое — массивное, тяжёлое, как в дорогих отелях.\nРазница в цене — примерно 5–8 тысяч на весь заказ.\n\nЕсли ванная у вас дорогая — это тот апгрейд, который заметен сразу.\nЕсли бюджет важен — 8 мм тоже хорошо, просто менее "премиально".',
   false, 2),

  ('vip',
   'VIP клиент — дизайнер или дорогой объект',
   'Клиент — дизайнер интерьера, пишет про премиальный объект или ЖК',
   E'Хорошо вас понимаю.\n\nДля таких объектов мы работаем немного иначе — без стандартных каталожных решений.\n\nМне важно понять: какой стиль интерьера, что уже выбрано, какие материалы? Тогда я смогу предложить что-то точно под ваш проект.\n\nЕсли удобно — можем созвониться на 10 минут, это быстрее, чем переписка.',
   true, 1)

ON CONFLICT DO NOTHING;
