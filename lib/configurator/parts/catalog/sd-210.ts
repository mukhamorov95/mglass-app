// Ручка-скоба SD-210/L230 — двусторонняя П-скоба, стекло 8–10 мм.
// Числа сняты с чертежа public/configurator/hardware/sd-210.jpg (см. source.drawing).
//
// Что показал чертёж и чего не было в коде:
//  · ручка ДВУСТОРОННЯЯ — две одинаковые половины по обе стороны полотна,
//    стянутые через два отверстия Ø10 с межосевым 210. Рисовали одну.
//  · хват — плоская планка 20×10, а не круглый пруток Ø10.
//  · 230 = 190 (хват) + 2×20 (плечи), плечи по краям, вынос 60 от плоскости стекла.

import type { PartSpec } from '../types'

const D = {
  totalLen: 230,   // габарит вдоль кромки двери
  gripLen: 190,    // чистая длина хвата между плечами
  armH: 20,        // высота плеча вдоль ручки
  barW: 20,        // ширина материала поперёк ручки
  reach: 60,       // вынос от плоскости стекла до внешней грани хвата
  gripThk: 10,     // толщина хвата (по выносу)
  boltPitch: 210,  // межосевое отверстий
  boltDia: 10,     // Ø отверстия в стекле
}

const armY = D.boltPitch / 2                 // 105 — центр плеча совпадает с осью отверстия
const gripZ = D.reach - D.gripThk / 2        // 55 — хват прижат к внешнему торцу плеч

export const SD_210_L230: PartSpec = {
  id: 'handle-bar',
  article: 'SD-210/L230',
  label: 'Ручка-скоба SD-210/L230',
  role: 'handle',
  supplier: { name: 'Vetro', url: 'https://vetro-furniture.ru/' },
  source: {
    drawing: '/configurator/hardware/sd-210.jpg',
    photos: ['/configurator/hardware/sd-210-photo.jpg'],
    note: 'Все размеры с чертежа. «8-10» на чертеже — толщина стекла, не деталь.',
  },
  dims: D,
  geometry: [
    // два плеча от стекла наружу
    { p: 'box', size: [D.barW, D.armH, D.reach], at: [0, armY, D.reach / 2], round: 1.5 },
    { p: 'box', size: [D.barW, D.armH, D.reach], at: [0, -armY, D.reach / 2], round: 1.5 },
    // хват между плечами, у внешнего края
    { p: 'box', size: [D.barW, D.gripLen, D.gripThk], at: [0, 0, gripZ], round: 2 },
  ],
  mount: {
    on: 'glass-face',
    standoff: 0,        // ноль детали лежит на плоскости стекла
    through: true,      // вторая половина — с изнанки полотна
    glassMm: [8, 10],
  },
}
