-- ─── B2B Development Center V2 ────────────────────────────────────────────

-- Add score and size fields to b2b_leads
ALTER TABLE b2b_leads
  ADD COLUMN IF NOT EXISTS score         TEXT DEFAULT 'C',  -- A | B | C
  ADD COLUMN IF NOT EXISTS size_category TEXT DEFAULT 'small', -- small | medium | large
  ADD COLUMN IF NOT EXISTS ai_summary    TEXT;

-- Update status options comment (no constraint change, just extending allowed values):
-- new | researched | contacted | call_done | presentation_sent | proposal_sent | negotiating | test_order | regular | lost

-- B2B outreach templates (per segment, auto-generated)
CREATE TABLE IF NOT EXISTS b2b_outreach_templates (
  id           SERIAL PRIMARY KEY,
  segment      TEXT NOT NULL,
  channel      TEXT NOT NULL DEFAULT 'whatsapp', -- whatsapp | telegram | email | call
  stage        TEXT NOT NULL DEFAULT 'cold',     -- cold | follow1 | follow2 | reactivation
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  cta          TEXT,
  active       BOOLEAN DEFAULT true,
  created_at   TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE b2b_outreach_templates ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'rls_b2b_outreach' AND tablename = 'b2b_outreach_templates') THEN
    CREATE POLICY "rls_b2b_outreach" ON b2b_outreach_templates
      USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_b2b_outreach_segment ON b2b_outreach_templates (segment, stage);

-- Seed: outreach templates by segment
INSERT INTO b2b_outreach_templates (segment, channel, stage, title, body, cta) VALUES

-- ДИЗАЙНЕРЫ
('designer', 'whatsapp', 'cold',
 'Первый контакт с дизайнером',
 'Добрый день, [Имя]! Меня зовут [Менеджер], MGlass — производство стеклянных конструкций для интерьерных проектов в Москве. Производим душевые, зеркала, лофт-перегородки — только закалённое стекло, собственное производство. Работаем с дизайн-студиями на партнёрских условиях. Если у вас есть или планируются объекты со стеклом — с удовольствием пообщаемся. Удобно?',
 'Когда можно пообщаться 10 минут?'),

('designer', 'whatsapp', 'follow1',
 'Follow-up дизайнеру (день 3)',
 'Добрый день, [Имя]! Несколько дней назад написал про сотрудничество. Понимаю, что вы заняты. Если сейчас нет актуальных объектов — не вопрос. Если появятся — буду рад помочь с расчётом и подбором. Наш Instagram с примерами работ: [ссылка]. Если понравится — напишите.',
 NULL),

('designer', 'whatsapp', 'follow2',
 'Follow-up дизайнеру (день 10)',
 'Добрый день, [Имя]! Последний раз напишу, чтобы не надоедать. У нас есть партнёрская программа для дизайнеров — фиксированный % с каждого реализованного объекта, никакой операционки с вашей стороны. Если интересно узнать детали — напишите, расскажу за 5 минут.',
 'Хотите узнать про партнёрскую программу?'),

-- МЕБЕЛЬНЫЕ
('furniture', 'whatsapp', 'cold',
 'Первый контакт с мебельщиком',
 'Добрый день, [Имя]! MGlass — производство зеркал и стеклянных элементов для мебельных компаний. Резка, шлифовка, закалка, любые размеры и формы. Работаем с мебельными фабриками и студиями кухонь. Если периодически нужно стекло или зеркала для фасадов, вставок — могу прислать наши условия. Актуально?',
 'Пришлите текущий прайс или образцы'),

('furniture', 'whatsapp', 'follow1',
 'Follow-up мебельщику',
 'Добрый день, [Имя]! Недавно предлагал сотрудничество по стеклу и зеркалам. Если есть текущий поставщик — всё окей. Но если хотите сравнить цены или нужен резервный вариант — пришлю расчёт на типовые позиции. Без обязательств.',
 'Прислать расчёт на стандартные размеры?'),

-- СТРОИТЕЛИ
('construction', 'whatsapp', 'cold',
 'Первый контакт со строителем',
 'Добрый день, [Имя]! MGlass — производство и монтаж стеклянных конструкций для строительных и ремонтных компаний. Душевые, перегородки, зеркала под любой проект. Работаем под объекты в Москве и МО, выдерживаем сроки, есть бригады. Если бывают объекты со стеклом — могу рассказать об условиях работы с подрядчиками.',
 'Есть ли сейчас объекты со стеклом?'),

('construction', 'whatsapp', 'follow1',
 'Follow-up строителю',
 'Добрый день! Несколько дней назад предлагал сотрудничество. Понимаю что у строителей плотный график. Если появится объект с душевыми или перегородками — напишите, посчитаю быстро. Работаем с ИП и ООО, закрывающие документы.',
 NULL),

-- АЛЮМИНИЙ / ПЕРЕГОРОДКИ
('aluminum', 'whatsapp', 'cold',
 'Первый контакт с алюминиевой компанией',
 'Добрый день, [Имя]! Меня зовут [Менеджер], MGlass — производство закалённого стекла. Работаем с компаниями, которые производят алюминиевые конструкции и офисные перегородки — поставляем стекло под нарезку. Собственное производство, чёткие сроки, нарезка по вашим чертежам. Актуально?',
 'Прислать прайс на стекло?'),

-- СТЕКОЛЬНЫЕ
('glass_company', 'whatsapp', 'cold',
 'Первый контакт со стекольщиком',
 'Добрый день, [Имя]! MGlass — производство и обработка стекла в Москве. Закалка, резка, полировка, сверловка. Работаем с компаниями, у которых нет собственной печи закалки или нужны мощности в пиковые периоды. Если бывают заказы на закалку — могу прислать наши возможности и сроки.',
 'Интересно узнать про производственные мощности?'),

-- ОФИСЫ
('office', 'whatsapp', 'cold',
 'Первый контакт с офисным сегментом',
 'Добрый день, [Имя]! MGlass — производство и монтаж офисных перегородок из стекла (стиль лофт и стандартные). Используем только закалённое стекло, профиль под цвет интерьера. Работаем с управляющими компаниями и fit-out. Если планируете ремонт или перепланировку офиса — пришлю примеры и цены.',
 'Пришлите размеры или планировку')

ON CONFLICT DO NOTHING;
