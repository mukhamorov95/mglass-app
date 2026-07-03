-- Модели душевых перегородок — админ-редактируемые (Ф5 редизайна калькулятора душевых).
-- Калькулятор читает эту таблицу с фолбэком на константу SHOWER_MODELS в коде:
-- если таблица пуста/недоступна — используется код. Структурные поля (glass_count,
-- dim_type, hardware_type) сидируются из кода и обычно не меняются; админ правит
-- title/description/hardware_base/sort_order/active.

CREATE TABLE IF NOT EXISTS public.shower_models (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code          text NOT NULL UNIQUE,
  title         text NOT NULL,
  description   text NOT NULL DEFAULT '',
  glass_count   int  NOT NULL DEFAULT 1,
  dim_type      text NOT NULL DEFAULT 'single' CHECK (dim_type IN ('single','corner')),
  hardware_base int  NOT NULL DEFAULT 0,
  hardware_type text NOT NULL DEFAULT 'swing' CHECK (hardware_type IN ('stationary','swing','sliding')),
  sort_order    int  NOT NULL DEFAULT 0,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.shower_models ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "shower_models_read" ON public.shower_models;
CREATE POLICY "shower_models_read" ON public.shower_models FOR SELECT USING (true);

INSERT INTO public.shower_models (code, title, description, glass_count, dim_type, hardware_base, hardware_type, sort_order) VALUES
  ('M1','М1','Стационарная панель',1,'single',4000,'stationary',1),
  ('M2','М2','Неподвижное + распашная дверь',2,'single',13000,'swing',2),
  ('M3','М3','Распашная дверь + неподвижное',2,'single',13000,'swing',3),
  ('M4','М4','2 неподвижных + распашная дверь',3,'corner',17000,'swing',4),
  ('M5','М5','Только распашная дверь',1,'single',9000,'swing',5),
  ('M6','М6','Угловая: панель + дверь',2,'corner',15000,'swing',6),
  ('M7','М7','Угловая: 2 панели + дверь',3,'corner',18000,'swing',7),
  ('M8','М8','Угловая: 2 раздвижных двери',4,'corner',22000,'sliding',8),
  ('M9','М9','Угловая: раздвижная + 2 панели',3,'corner',17000,'sliding',9),
  ('M10','М10','Раздвижная прямая',2,'single',12000,'sliding',10),
  ('M11','М11','Трапециевидная с дверью',2,'single',14000,'swing',11),
  ('M12','М12','Раздвижная (вариант)',2,'single',12000,'sliding',12)
ON CONFLICT (code) DO NOTHING;
