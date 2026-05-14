-- Mirror lighting components reference table
-- Used by the modular mirror calculator

CREATE TABLE IF NOT EXISTS mirror_lighting_components (
  id              SERIAL PRIMARY KEY,
  component_type  TEXT    NOT NULL CHECK (component_type IN ('frame', 'led_strip', 'power_supply', 'diffuser')),
  name            TEXT    NOT NULL,
  description     TEXT,
  voltage         INTEGER,          -- 12 or 24; NULL = not applicable
  color_temp      INTEGER,          -- Kelvin: 3000/4000/6000; for led_strip
  power_per_meter NUMERIC,          -- W/m; for led_strip
  max_power       INTEGER,          -- W; for power_supply
  cost_price      NUMERIC NOT NULL DEFAULT 0,
  sale_price      NUMERIC,
  unit            TEXT    NOT NULL DEFAULT 'шт',
  active          BOOLEAN NOT NULL DEFAULT true,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Frames ────────────────────────────────────────────────────────────────────
INSERT INTO mirror_lighting_components (component_type, name, description, cost_price, unit, sort_order) VALUES
('frame', 'Профиль 20×20', 'Стандартный алюминиевый профиль',  100, 'пог.м', 1),
('frame', 'Профиль 30×30', 'Широкий алюминиевый профиль',      150, 'пог.м', 2),
('frame', 'Профиль 20×10', 'Плоский алюминиевый профиль',       80, 'пог.м', 3);

-- ── LED strips ────────────────────────────────────────────────────────────────
INSERT INTO mirror_lighting_components (component_type, name, voltage, color_temp, power_per_meter, cost_price, unit, sort_order) VALUES
('led_strip', 'LED 12V 3000K 9.6Вт/м',  12, 3000,  9.6, 180, 'пог.м',  1),
('led_strip', 'LED 12V 4000K 9.6Вт/м',  12, 4000,  9.6, 180, 'пог.м',  2),
('led_strip', 'LED 12V 6000K 9.6Вт/м',  12, 6000,  9.6, 180, 'пог.м',  3),
('led_strip', 'LED 12V 3000K 12Вт/м',   12, 3000, 12.0, 220, 'пог.м',  4),
('led_strip', 'LED 12V 4000K 12Вт/м',   12, 4000, 12.0, 220, 'пог.м',  5),
('led_strip', 'LED 24V 3000K 9.6Вт/м',  24, 3000,  9.6, 200, 'пог.м',  6),
('led_strip', 'LED 24V 4000K 9.6Вт/м',  24, 4000,  9.6, 200, 'пог.м',  7),
('led_strip', 'LED 24V 6000K 9.6Вт/м',  24, 6000,  9.6, 200, 'пог.м',  8),
('led_strip', 'LED 24V 3000K 12Вт/м',   24, 3000, 12.0, 250, 'пог.м',  9),
('led_strip', 'LED 24V 3000K 24Вт/м',   24, 3000, 24.0, 350, 'пог.м', 10);

-- ── Power supplies ────────────────────────────────────────────────────────────
INSERT INTO mirror_lighting_components (component_type, name, voltage, max_power, cost_price, unit, sort_order) VALUES
('power_supply', 'БП 12V 36Вт',  12,  36,  550, 'шт', 1),
('power_supply', 'БП 12V 60Вт',  12,  60,  700, 'шт', 2),
('power_supply', 'БП 12V 100Вт', 12, 100, 1000, 'шт', 3),
('power_supply', 'БП 12V 150Вт', 12, 150, 1300, 'шт', 4),
('power_supply', 'БП 24V 36Вт',  24,  36,  600, 'шт', 5),
('power_supply', 'БП 24V 60Вт',  24,  60,  750, 'шт', 6),
('power_supply', 'БП 24V 100Вт', 24, 100, 1100, 'шт', 7),
('power_supply', 'БП 24V 150Вт', 24, 150, 1400, 'шт', 8);

-- ── Diffusers ─────────────────────────────────────────────────────────────────
INSERT INTO mirror_lighting_components (component_type, name, cost_price, unit, sort_order) VALUES
('diffuser', 'Без рассеивателя',        0, 'пог.м', 1),
('diffuser', 'Рассеиватель стандарт',  80, 'пог.м', 2),
('diffuser', 'Рассеиватель премиум',  120, 'пог.м', 3);
