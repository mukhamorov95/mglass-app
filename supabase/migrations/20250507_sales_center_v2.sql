-- ─── Sales Center V2 ──────────────────────────────────────────────────────────

-- Knowledge base articles
CREATE TABLE IF NOT EXISTS sales_knowledge_base (
  id          SERIAL PRIMARY KEY,
  category    TEXT NOT NULL, -- glass | hardware | installation | pricing | competitors | b2b | objections | guarantee
  title       TEXT NOT NULL,
  content     TEXT NOT NULL,
  tags        TEXT[] DEFAULT '{}',
  active      BOOLEAN DEFAULT true,
  sort_order  INT DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE sales_knowledge_base ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rls_knowledge_base" ON sales_knowledge_base
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- Follow-up templates
CREATE TABLE IF NOT EXISTS sales_followups (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  delay_days  INT NOT NULL DEFAULT 1,
  channel     TEXT NOT NULL DEFAULT 'whatsapp', -- whatsapp | telegram | call | email
  context     TEXT NOT NULL DEFAULT 'general',  -- after_quote | no_answer | price_objection | measurement_done | general
  body        TEXT NOT NULL,
  cta         TEXT,
  bonus_offer TEXT,
  active      BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE sales_followups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rls_followups" ON sales_followups
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- B2B leads database
CREATE TABLE IF NOT EXISTS b2b_leads (
  id                   SERIAL PRIMARY KEY,
  company_name         TEXT NOT NULL,
  segment              TEXT NOT NULL DEFAULT 'designer', -- designer | glass_company | furniture | construction | office | renovation | aluminum | studio
  contact_name         TEXT,
  phone                TEXT,
  email                TEXT,
  instagram            TEXT,
  website              TEXT,
  city                 TEXT DEFAULT 'Москва',
  status               TEXT NOT NULL DEFAULT 'new', -- new | contacted | replied | negotiating | proposal_sent | client | regular | pass
  source               TEXT DEFAULT 'manual', -- manual | instagram | referral | avito | 2gis | cold_call
  notes                TEXT,
  potential_monthly    DECIMAL(10,2),
  last_contact_date    DATE,
  created_by           UUID REFERENCES users(id),
  created_at           TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE b2b_leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rls_b2b_leads" ON b2b_leads
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- B2B lead activity log
CREATE TABLE IF NOT EXISTS b2b_lead_activities (
  id               SERIAL PRIMARY KEY,
  lead_id          INT REFERENCES b2b_leads(id) ON DELETE CASCADE,
  type             TEXT NOT NULL, -- call | whatsapp | email | meeting | proposal | note
  note             TEXT NOT NULL,
  outcome          TEXT,          -- interested | not_interested | callback | sent_info | no_answer
  next_action      TEXT,
  next_action_date DATE,
  created_by       UUID REFERENCES users(id),
  created_at       TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE b2b_lead_activities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rls_b2b_activities" ON b2b_lead_activities
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_b2b_leads_status   ON b2b_leads (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_b2b_leads_segment  ON b2b_leads (segment);
CREATE INDEX IF NOT EXISTS idx_b2b_activities_lead ON b2b_lead_activities (lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_cat       ON sales_knowledge_base (category, sort_order);

-- ─── Seed: Knowledge Base ─────────────────────────────────────────────────────

INSERT INTO sales_knowledge_base (category, title, content, tags, sort_order) VALUES
  ('glass', 'Закалённое стекло vs обычное',
   'Закалённое стекло прочнее обычного в 5-7 раз. При разрушении распадается на мелкие тупые осколки — безопасно. Обычное стекло разрушается на острые крупные куски. Для душевых обязательно закалённое — по ГОСТ и по здравому смыслу. Мы используем ТОЛЬКО закалённое.',
   ARRAY['стекло', 'безопасность', 'закалка'], 1),

  ('glass', 'Толщина стекла: 6, 8 или 10 мм',
   '6 мм — базовый вариант, допустим для раздвижных дверей небольшого размера. 8 мм — стандарт для большинства душевых, оптимальное соотношение цены и качества. 10 мм — premium, ощущение массивности, больший вес, дороже фурнитура. Клиентам на 8 мм — если нет особых пожеланий. 10 мм — VIP и дизайнерские объекты.',
   ARRAY['стекло', 'толщина', 'выбор'], 2),

  ('glass', 'Crystal Vision — что это',
   'Crystal Vision — особый тип стекла с минимальным содержанием железа. Обычное стекло имеет зеленоватый оттенок на срезе. Crystal Vision — чистый, почти водяной цвет. Дороже на 25-35%. Используется в premium объектах, где важна визуальная чистота. Хорошо продаётся дизайнерам и в апартаменты.',
   ARRAY['Crystal Vision', 'premium', 'стекло'], 3),

  ('hardware', 'Хром vs матовый чёрный — как выбрать',
   'Хром — классика, подходит к 80% ванных. Легко моется, скрывает водные пятна. Матовый чёрный — трендовый выбор, отлично смотрится в современных интерьерах, но требует чаще протирать. Золото/брашированное — для luxury интерьеров. Совет менеджеру: спроси про стиль ванной, покажи фото обоих вариантов.',
   ARRAY['фурнитура', 'хром', 'чёрный'], 1),

  ('hardware', 'Петли — какие лучше',
   'Петли бывают регулируемые и нерегулируемые. Регулируемые — дороже, но можно настроить угол и плотность прилегания после монтажа. Для premium — только регулируемые. Нерегулируемые — быстрее монтаж, дешевле. Клиентам с нестандартными стенами (неровными) — регулируемые обязательно.',
   ARRAY['петли', 'фурнитура', 'монтаж'], 2),

  ('installation', 'Сроки монтажа — что говорить клиенту',
   'Замер → 3-5 рабочих дней производство → монтаж. Итого: 5-7 рабочих дней с момента оплаты. В сезон (март-сентябрь) может быть 7-10 дней. Всегда добавляй 1-2 дня буфера. НЕ обещай быстрее, чем можем. Если клиент торопится — узнай дату X и планируй под неё. Прозрачность по срокам = доверие.',
   ARRAY['сроки', 'монтаж', 'производство'], 1),

  ('pricing', 'Как объяснить цену клиенту',
   'Никогда не извиняйся за цену. Цена — это следствие качества. Структура объяснения: 1) Закалённое стекло (безопасность) 2) Качественная фурнитура (долговечность) 3) Собственное производство (контроль) 4) Гарантия 2 года 5) Опыт X лет и N объектов. Потом: "Цена за [размер] составит X рублей. Включает замер, производство, монтаж и гарантию." Без извинений, уверенно.',
   ARRAY['цена', 'возражение', 'скрипт'], 1),

  ('competitors', 'Как работать с конкурентами',
   'Никогда не критикуй конкурентов напрямую — это снижает доверие. Вместо "они плохие" — "у нас есть конкретные преимущества". Что реально отличает MGlass: собственное производство (контроль качества), только закалённое стекло, гарантия 2 года, опыт на сложных объектах. Если клиент говорит "нашёл дешевле" — спроси: закалённое ли стекло? Какая гарантия? Есть ли собственное производство?',
   ARRAY['конкуренты', 'УТП', 'возражение'], 1),

  ('guarantee', 'Гарантия — что говорить',
   'Гарантия на конструкцию — 2 года. Гарантия на стекло от разрушения (при правильной эксплуатации) — де-факто бессрочная, закалённое стекло не разрушается от времени. Что не входит в гарантию: механические повреждения, неправильный уход, самостоятельные попытки ремонта. Гарантия — сильный аргумент против более дешёвых конкурентов.',
   ARRAY['гарантия', 'доверие', 'аргумент'], 1),

  ('b2b', 'Что предлагать B2B партнёрам',
   'Три модели работы: 1) РЕФЕРАЛЬНАЯ — партнёр даёт контакты, получает % от заказа (10-15%). 2) ДИЛЕРСКАЯ — партнёр покупает по дилерской цене, продаёт сам. 3) ПОДРЯДНАЯ — партнёр получает скидку за объём. Для дизайнеров — реферальная лучше всего, они не хотят заниматься операционкой. Для мебельных компаний — дилерская или подрядная.',
   ARRAY['B2B', 'партнёры', 'модели'], 1)
ON CONFLICT DO NOTHING;

-- ─── Seed: Follow-up Templates ────────────────────────────────────────────────

INSERT INTO sales_followups (name, delay_days, channel, context, body, cta, bonus_offer) VALUES
  ('После КП — день 1', 1, 'whatsapp', 'after_quote',
   'Добрый день, [Имя]! Вчера отправил вам расчёт по душевой. Хотел уточнить — всё понятно по составу? Если есть вопросы по материалам или срокам — с удовольствием отвечу.',
   'Напишите "+" если готовы обсудить', NULL),

  ('После КП — день 3', 3, 'whatsapp', 'after_quote',
   'Добрый день, [Имя]! Несколько дней назад отправил расчёт. Понимаю, что решение не принимается быстро — это нормально. Если сравниваете с другими вариантами, могу рассказать на что обращать внимание при выборе, чтобы потом не пожалеть.',
   'Когда удобно пообщаться 5 минут?', NULL),

  ('После КП — день 7', 7, 'whatsapp', 'after_quote',
   'Здравствуйте, [Имя]! Неделю назад отправил расчёт по вашей душевой. Если ещё в процессе поиска — мы сейчас делаем замеры бесплатно, без обязательств. Просто посмотрим, пообщаемся и вы поймёте реальную стоимость для вашего случая.',
   'Запишитесь на бесплатный замер', 'Бесплатный замер без обязательств'),

  ('Нет ответа — день 2', 2, 'whatsapp', 'no_answer',
   'Добрый день, [Имя]! Пытался дозвониться. Если неудобно говорить — напишите, когда можно перезвонить. Или можем всё обсудить в переписке — как вам удобнее.',
   'Когда удобно пообщаться?', NULL),

  ('Возражение по цене — день 2', 2, 'whatsapp', 'price_objection',
   'Добрый день, [Имя]! Понимаю, что цена — важный фактор. Хочу быть честным: мы не демпингуем, потому что используем только закалённое стекло и качественную фурнитуру. Но готов найти вариант в вашем бюджете — иногда достаточно немного скорректировать размеры или модель фурнитуры.',
   'Давайте найдём ваш вариант?', NULL),

  ('После замера — день 1', 1, 'whatsapp', 'measurement_done',
   'Добрый день, [Имя]! Спасибо, что приняли нашего замерщика. Расчёт пришлю сегодня до вечера. Если пока есть вопросы по вариантам — звоните или пишите.',
   NULL, NULL),

  ('Реактивация — месяц', 30, 'whatsapp', 'general',
   'Добрый день, [Имя]! Месяц назад общались по душевой. Если ещё в поиске — у нас сейчас есть несколько освободившихся слотов на замер на следующей неделе. Если уже решили вопрос с другой компанией — не страшно, если будут знакомые кто будет искать — буду рад помочь.',
   NULL, NULL)
ON CONFLICT DO NOTHING;
