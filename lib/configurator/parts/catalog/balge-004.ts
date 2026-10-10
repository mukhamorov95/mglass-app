// Петля Balge-004 стекло-стекло 135–180°, латунь (Ветро). Открывание наружу.
// Числа сняты с чертежа поставщика (вкладка «Документы» карточки, см. source.drawing):
//  · габарит 100 × 70; корпус с одной стороны стекла — створки 41,5 (неподвижное) и 57 (дверь);
//  · толщина корпуса 13 / 12, с другой стороны — накладки 35 шириной, 6,75 / 5,75 толщиной;
//  · сверху 35 | 30 | 35; отверстия Ø14 по два на стекло, шаг 45, 28 от кромки; зазор 8.
// Стык — посередине: центр накладки 17,5 + 28 до кромки ≈ 46, кромка двери — 54 от торца.
// Высота накладок и диаметр шарнира не размечены: накладки — во всю высоту (по фото), шарнир не рисуем.
// Нагрузки на карточке нет — число петель считается по габариту двери, а не по паспорту.

import type { PartSpec } from '../types'

const D = {
  total: 100,       // габарит поперёк стыка
  height: 70,       // высота
  fixedLeaf: 41.5,  // створка корпуса на неподвижном стекле
  split: 1.5,       // разрез между створками корпуса
  doorLeaf: 57,     // створка корпуса на двери
  bodyFixed: 13,    // толщина корпуса над неподвижным стеклом
  bodyDoor: 12,     // толщина корпуса над дверью
  capW: 35,         // ширина накладки с обратной стороны
  capFixed: 6.75,   // толщина накладки на неподвижном
  capDoor: 5.75,    // толщина накладки на двери
  gap: 8,           // зазор между полотнами при 180°
  glass: 8,         // стекло, под которое нарисована петля (карточка: 8–10)
}

const edge = (D.total + D.gap) / 2   // 54 — кромка двери от торца на неподвижном стекле
const z = (x: number) => edge - x    // от торца чертежа к рамке паспорта
const face = D.glass / 2

export const BALGE_004: PartSpec = {
  id: 'hinge-balge-004',
  article: 'Balge-004',
  label: 'Петля Balge-004 стекло-стекло 135–180°',
  role: 'hinge',
  supplier: { name: 'vetro', url: 'https://vetro-furniture.ru/catalog/petli_dlya_dushevykh/premium_petli/1873/?oid=1874' },
  source: {
    drawing: 'https://vetro-furniture.ru/upload/iblock/cbb/an5vf2kq5sc3uzi05jl895fv3un2t9y6.jpg',
    note: 'Размеры — с чертежа Ветро: 100 × 70, створки 41,5 + 57, корпус 13/12, накладки 35 × 6,75/5,75. Высота накладок не размечена (взята во всю высоту), шарнир без диаметра — не рисуем. Нагрузки на карточке нет.',
  },
  dims: D,
  // Ноль — на петлевой кромке двери; +Z — через стык к неподвижному стеклу; +X — сторона корпуса.
  geometry: [
    { p: 'box', size: [D.bodyFixed, D.height, D.fixedLeaf], at: [face + D.bodyFixed / 2, 0, z(D.fixedLeaf / 2)], round: 4 },
    { p: 'box', size: [D.bodyDoor, D.height, D.doorLeaf], at: [face + D.bodyDoor / 2, 0, z(D.fixedLeaf + D.split + D.doorLeaf / 2)], round: 4 },
    { p: 'box', size: [D.capFixed, D.height, D.capW], at: [-(face + D.capFixed / 2), 0, z(D.capW / 2)], round: 2 },
    { p: 'box', size: [D.capDoor, D.height, D.capW], at: [-(face + D.capDoor / 2), 0, z(D.total - D.capW / 2)], round: 2 },
  ],
  mount: {
    on: 'glass-edge',
    standoff: 0,
    glassMm: [8, 10],
  },
}
