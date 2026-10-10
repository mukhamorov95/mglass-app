// Петля «Афродита» FDP-232 стекло-стекло 180°, латунь, с крышками (АВ24).
// Числа сняты с чертежа поставщика public/configurator/hardware/fdp-232.jpg:
//  · габарит 115 × 60, толщина по крышкам 20,7, крышки по 5,5;
//  · зазор между полотнами 1,5; ось — 55 от торца крышки на стороне неподвижного стекла;
//  · вырез в стекле под механизм 18 × 30.
// Нагрузка «до 35 кг на 2 петли» и стекло 6–10 мм — с карточки товара (раздел «Характеристики»).

import type { PartSpec } from '../types'

const D = {
  total: 115,       // габарит поперёк стыка
  height: 60,       // высота
  thk: 20.7,        // толщина по крышкам
  plate: 5.5,       // толщина крышки
  gap: 1.5,         // зазор между полотнами
  axisToEnd: 55,    // от оси до торца на стороне неподвижного стекла
  cutW: 18,         // вырез под механизм вдоль стыка
  cutH: 30,         // вырез под механизм по высоте
}

const doorLeaf = D.total - D.axisToEnd - D.gap   // 58,5 — сторона двери
const plateX = D.thk / 2 - D.plate / 2            // 7,6 — центр крышки от середины стекла

export const FDP_232: PartSpec = {
  id: 'hinge-fdp-232',
  article: 'FDP-232',
  label: 'Петля FDP-232 стекло-стекло 180°',
  role: 'hinge',
  supplier: { name: 'av24', url: 'https://av24.su/petlya-afrodita-steklo-steklo-180-s-kryshkami-fdp-232-br-bl/' },
  source: {
    drawing: '/configurator/hardware/fdp-232.jpg',
    note: 'Размеры — с чертежа поставщика. Нагрузка 35 кг на 2 петли и стекло 6–10 мм — с карточки.',
  },
  dims: D,
  load: { kgPer2: 35, note: 'карточка АВ24, «Нагрузка: до 35 кг на 2 петли»' },
  // Ноль — на петлевой кромке двери; +Z — через стык к неподвижному стеклу; X — по толщине.
  geometry: [
    { p: 'box', size: [D.plate, D.height, doorLeaf], at: [plateX, 0, -doorLeaf / 2], round: 1, leaf: 'door' },
    { p: 'box', size: [D.plate, D.height, doorLeaf], at: [-plateX, 0, -doorLeaf / 2], round: 1, leaf: 'door' },
    { p: 'box', size: [D.plate, D.height, D.axisToEnd], at: [plateX, 0, D.gap + D.axisToEnd / 2], round: 1, leaf: 'fixed' },
    { p: 'box', size: [D.plate, D.height, D.axisToEnd], at: [-plateX, 0, D.gap + D.axisToEnd / 2], round: 1, leaf: 'fixed' },
    // механизм в вырезе стекла: между крышками, по центру стыка
    { p: 'box', size: [D.thk - 2 * D.plate, D.cutH, D.cutW], at: [0, 0, D.gap / 2] },
  ],
  mount: {
    on: 'glass-edge',
    standoff: 0,
    glassMm: [6, 10],
  },
}
