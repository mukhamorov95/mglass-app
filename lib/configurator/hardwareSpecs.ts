// Реальные размеры фурнитуры M-Glass (с чертежей vetro-furniture.ru) — единый
// источник правды для 3D-моделей (components/configurator/scene/hardware.tsx).
// Все значения в МИЛЛИМЕТРАХ. Артикулы совпадают с lib/configurator/catalog.ts.
// Фото/чертежи: public/configurator/hardware/*.jpg.

export type HingeSpec = {
  code: string
  shape: 'rounded' | 'square'     // Balge — скруглённая, Dessau — прямоугольная (премиум)
  bodyW: number                   // габарит поперёк (охватывает оба стекла)
  bodyH: number                   // высота вдоль кромки
  plateW: number                  // ширина одной пластины (пятки) на стекле
  plateThk: number                // толщина пластины (выступ от стекла)
  gap: number                     // зазор между стёклами
  boltDia: number                 // Ø отверстия в стекле
  boltPitch: number               // шаг отверстий по вертикали
  glassMm: [number, number]
}

// Balge-004 180° (см. public/configurator/hardware/balge-004.jpg)
export const BALGE_004: HingeSpec = {
  code: 'Balge-004', shape: 'rounded',
  bodyW: 100, bodyH: 70, plateW: 35, plateThk: 6.75, gap: 8,
  boltDia: 14, boltPitch: 45, glassMm: [8, 10],
}

// Dessau-103 180° (см. public/configurator/hardware/dessau-103.jpg)
export const DESSAU_103: HingeSpec = {
  code: 'Dessau-103', shape: 'square',
  bodyW: 117, bodyH: 60, plateW: 47, plateThk: 6, gap: 8,
  boltDia: 14, boltPitch: 38, glassMm: [8, 10],
}

// Ручка-скоба SD-210/L230 — двусторонняя П-скоба (см. sd-210.jpg)
export const SD_210 = {
  code: 'SD-210/L230',
  totalLen: 230,      // полная длина
  gripLen: 190,       // длина хвата
  armReach: 60,       // вынос плеча от стекла
  barSection: 20,     // сечение плеча
  gripDia: 10,        // Ø хвата (тела)
  boltDia: 10,        // Ø отверстия в стекле
  boltPitch: 210,     // шаг отверстий
  standoff: 20,       // отступ хвата от стекла (высота плеча)
}

// Штанга Ш-002 30×10 (несущая, стенка 1.5 мм), продаётся по 2 п.м
export const BAR_30x10 = { code: 'Ш-002', w: 30, h: 10, wall: 1.5 }

// П-профиль Pr-002 18×12,5 (пристеночный, под стекло 8 мм)
export const PROFILE_PR002 = { code: 'Pr-002', w: 18, h: 12.5 }

// Раздвижная система РД-001 (Hip System 30×10): верхнеподвесная на штанге 30×10.
// Стекло 8–10, дверь ≤40 кг, макс. H 2100, макс. ширина полотна 750.
// PDF: https://vetro-furniture.ru/upload/iblock/328/7zjm9y9jkw16a9cx6oyq1h6p8vsc1g4b.pdf
export const RD_001 = {
  code: 'РД-001',
  railW: 30, railH: 10,      // несущая штанга
  carrierW: 40, carrierH: 34, // каретка-ролик (габарит), уточнить по PDF
  maxPanelW: 750, maxKg: 40, maxH: 2100,
  glassMm: [8, 10],
}
