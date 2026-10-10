// Петля Dessau-103 стекло-стекло 180°, латунь (Ветро).
// Числа сняты с чертежа поставщика (вкладка «Документы» карточки, см. source.drawing):
//  · габарит 117 × 60: сторона двери 70, сторона неподвижного 47 — от оси;
//  · ось — посередине зазора между полотнами 8; крышки по 6 с каждой стороны стекла;
//  · вырез в двери 40 × 38, в неподвижном 16 × 28 — механизм прячется между крышками.
// Нагрузки на карточке нет — число петель считается по габариту двери, а не по паспорту.

import type { PartSpec } from '../types'

const D = {
  total: 117,       // габарит поперёк стыка
  height: 60,       // высота
  doorSide: 70,     // от оси до торца на стороне двери
  fixedSide: 47,    // от оси до торца на стороне неподвижного стекла
  gap: 8,           // зазор между полотнами
  plate: 6,         // толщина крышки
  glass: 8,         // стекло, под которое нарисована петля (карточка: 8–10)
  cutH: 38,         // вырез под механизм в двери по высоте
}

const axis = D.gap / 2                    // 4 — ось от петлевой кромки двери
const seam = 1                            // шов между половинами: на чертеже не размечен, нужен, чтобы читались две створки
const plateX = D.glass / 2 + D.plate / 2  // 7 — центр крышки от середины стекла
const doorLen = D.doorSide - seam / 2
const fixedLen = D.fixedSide - seam / 2

export const DESSAU_103: PartSpec = {
  id: 'hinge-dessau-103',
  article: 'Dessau-103',
  label: 'Петля Dessau-103 стекло-стекло 180°',
  role: 'hinge',
  supplier: { name: 'vetro', url: 'https://vetro-furniture.ru/catalog/petli_dlya_dushevykh/premium_petli/2087/?oid=4146' },
  source: {
    drawing: 'https://vetro-furniture.ru/upload/iblock/85c/757s88lg7h1ato1d5nikk5h3cv4awvvc.jpg',
    note: 'Размеры — с чертежа Ветро: 117 × 60, 70 + 47 от оси, зазор 8, крышки 6. Скругления выреза (R13, R9) не рисуем — их не видно за крышками. Нагрузки на карточке нет.',
  },
  dims: D,
  // Ноль — на петлевой кромке двери; +Z — через стык к неподвижному стеклу; X — по толщине.
  geometry: [
    { p: 'box', size: [D.plate, D.height, doorLen], at: [plateX, 0, axis - seam / 2 - doorLen / 2], round: 1.5, leaf: 'door' },
    { p: 'box', size: [D.plate, D.height, doorLen], at: [-plateX, 0, axis - seam / 2 - doorLen / 2], round: 1.5, leaf: 'door' },
    { p: 'box', size: [D.plate, D.height, fixedLen], at: [plateX, 0, axis + seam / 2 + fixedLen / 2], round: 1.5, leaf: 'fixed' },
    { p: 'box', size: [D.plate, D.height, fixedLen], at: [-plateX, 0, axis + seam / 2 + fixedLen / 2], round: 1.5, leaf: 'fixed' },
    // механизм в зазоре между полотнами, высотой выреза; чуть тоньше стекла — грани не совпадают
    { p: 'box', size: [D.glass - 0.6, D.cutH, D.gap], at: [0, 0, axis], leaf: 'door' },
  ],
  mount: {
    on: 'glass-edge',
    standoff: 0,
    glassMm: [8, 10],
  },
}
