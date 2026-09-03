// Ручка-кноб FDR-30 квадратная — двусторонняя, через отверстие в полотне.
//
// ВНИМАНИЕ: числа сняты с ФОТО карточки поставщика, а не с чертежа. 30 — из артикула
// (сторона квадратной пластины). Длина штока, толщина пластины и Ø отверстия
// подтверждения чертежом ещё не получили — см. source.note.
// Пока это лучше прежнего: там кноб рисовался шаром на палочке и с одной стороны.

import type { PartSpec } from '../types'

const D = {
  plate: 30,       // сторона квадратной пластины (из артикула FDR-30)
  plateThk: 10,    // толщина пластины
  stemDia: 20,     // Ø штока
  stemLen: 22,     // шток от шайбы до пластины
  washerDia: 22,   // Ø резиновой шайбы у стекла
  washerThk: 3,    // толщина шайбы
}

const stemZ = D.washerThk + D.stemLen / 2
const plateZ = D.washerThk + D.stemLen + D.plateThk / 2

export const FDR_30: PartSpec = {
  id: 'handle-knob',
  article: 'FDR-30',
  label: 'Ручка-кноб FDR-30 квадратная',
  role: 'handle',
  supplier: { name: 'av24', url: 'https://av24.su/' },
  source: {
    photos: ['https://av24.su/wa-data/public/shop/products/60/52/5260/images/26703/26703.750x0.jpg'],
    note: 'Размеры с фото карточки, не с чертежа. Подтвердить: длина штока, толщина пластины, Ø отверстия в стекле.',
  },
  dims: D,
  geometry: [
    { p: 'cyl', d: D.washerDia, len: D.washerThk, axis: 'z', at: [0, 0, D.washerThk / 2] },
    { p: 'cyl', d: D.stemDia, len: D.stemLen, axis: 'z', at: [0, 0, stemZ] },
    { p: 'box', size: [D.plate, D.plate, D.plateThk], at: [0, 0, plateZ], round: 1 },
  ],
  mount: {
    on: 'glass-face',
    standoff: 0,
    through: true,        // кноб стягивается через отверстие: две половины, одна позиция
    glassMm: [8, 10],
  },
}
