// Петля Balge-004 стекло-стекло 135–180°, латунь (Ветро). Открывание наружу — в сторону корпуса.
// Числа сняты с чертежа поставщика (вкладка «Документы» карточки, см. source.drawing):
//  · габарит 100 × 70; створки корпуса 41,5 (неподвижное) и 57 (дверь);
//  · вид сверху 180°: корпус с одной стороны стекла — серп глубиной 13 у шарнира, накладки 35 × 6,75
//    с другой; сверху 35 | 30 | 35; отверстия Ø14, по два на стекло, шаг 45, 28 от кромки; зазор 8;
//  · без стекла: накладка двери 5,75, корпус двери 12 — в сборке 180° у корпуса одна дуга 13.
// Не размечено и снято по масштабу вида сверху (35 мм = 181 px, ±0,3 мм): дуга серпа (концы 2 мм),
// шарнир Ø13 на оси посередине зазора, вырезы под поворот R8 глубиной 5,8. Высота накладок не
// размечена — во всю высоту (по фото). Нагрузки на карточке нет — число петель по габариту двери.

import type { PartSpec } from '../types'
import { arc, angleAt, type P2 } from '../outline'

const D = {
  total: 100,       // габарит поперёк стыка
  height: 70,       // высота
  fixedLeaf: 41.5,  // створка корпуса на неподвижном стекле
  split: 1.5,       // разрез между створками корпуса
  doorLeaf: 57,     // створка корпуса на двери, с шарниром
  depth: 13,        // корпус у шарнира — от стекла до низа серпа
  tip: 2,           // толщина серпа на концах (по масштабу)
  knuckle: 13,      // Ø шарнира (по масштабу — во всю глубину корпуса)
  notchR: 8,        // радиус выреза под поворот (по масштабу)
  notchDepth: 5.8,  // глубина выреза (по масштабу)
  notchOff: 10.75,  // центр выреза от оси (по масштабу)
  capW: 35,         // ширина накладки с обратной стороны
  capFixed: 6.75,   // толщина накладки на неподвижном
  capDoor: 5.75,    // толщина накладки на двери
  gap: 8,           // зазор между полотнами при 180°
  glass: 8,         // стекло, под которое нарисована петля (карточка: 8–10)
  hole: 14,         // отверстие в стекле
  holeFromEdge: 28, // центр отверстия от кромки
  holePitch: 45,    // шаг отверстий по высоте
}

// Чертёж: x — вдоль стыка от торца на неподвижном стекле, d — от стекла вглубь корпуса.
const axis = D.total / 2                    // ось шарнира — посередине зазора
const edge = (D.total + D.gap) / 2          // 54 — кромка двери от торца
const face = D.glass / 2
const sag = D.depth - D.tip
const R = (axis * axis + sag * sag) / (2 * sag)   // радиус дуги серпа, ≈ 119
const belly: P2 = [axis, D.depth - R]
const notchC = (s: 1 | -1): P2 => [axis + s * D.notchOff, D.notchDepth - D.notchR]
const notchEnd = Math.sqrt(D.notchR ** 2 - (D.notchR - D.notchDepth) ** 2)  // полухорда выреза у стекла
const knuckleC: P2 = [axis, D.knuckle / 2]
const toPart = ([x, d]: P2): [number, number] => [+(face + d).toFixed(2), +(edge - x).toFixed(2)]
// Дуги стыкуются концами — повтор точки даёт вырожденное ребро контура.
const contour = (pts: P2[]) => pts.map(toPart).filter((p, i, a) => i === 0 || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1])

const fixedLeaf: P2[] = [
  [0, 0],
  ...arc(notchC(-1), D.notchR, angleAt(notchC(-1), D.notchR, notchC(-1)[0] - notchEnd), angleAt(notchC(-1), D.notchR, D.fixedLeaf)),
  ...arc(belly, R, angleAt(belly, R, D.fixedLeaf), angleAt(belly, R, 0)),
]

const doorLeaf: P2[] = [
  [D.total, 0],
  ...arc(belly, R, angleAt(belly, R, D.total), 90),
  ...arc(knuckleC, D.knuckle / 2, 90, 270),
  ...arc(notchC(1), D.notchR, angleAt(notchC(1), D.notchR, notchC(1)[0] - notchEnd), angleAt(notchC(1), D.notchR, notchC(1)[0] + notchEnd)),
]

const z = (x: number) => edge - x
const holeFixed = edge - D.gap - D.holeFromEdge   // 18 от торца
const holeDoor = edge + D.holeFromEdge            // 82 от торца

export const BALGE_004: PartSpec = {
  id: 'hinge-balge-004',
  article: 'Balge-004',
  label: 'Петля Balge-004 стекло-стекло 135–180°',
  role: 'hinge',
  supplier: { name: 'vetro', url: 'https://vetro-furniture.ru/catalog/petli_dlya_dushevykh/premium_petli/1873/?oid=1874' },
  source: {
    drawing: 'https://vetro-furniture.ru/upload/iblock/cbb/an5vf2kq5sc3uzi05jl895fv3un2t9y6.jpg',
    note: 'Размеры — с чертежа Ветро: 100 × 70, створки 41,5 + 57, корпус 13, накладки 35 × 6,75/5,75, отверстия Ø14 через 45, 28 от кромки. Дуга серпа, шарнир Ø13 и вырезы R8 — по масштабу вида сверху. Высота накладок не размечена (во всю высоту). Нагрузки на карточке нет.',
  },
  dims: D,
  // Ноль — на петлевой кромке двери; +Z — через стык к неподвижному стеклу; +X — сторона корпуса
  // (сцена разворачивает её наружу кабины).
  geometry: [
    { p: 'extrude', outline: contour(fixedLeaf), height: D.height, bevel: 0.6, leaf: 'fixed' },
    { p: 'extrude', outline: contour(doorLeaf), height: D.height, bevel: 0.6, leaf: 'door' },
    { p: 'box', size: [D.capFixed, D.height, D.capW], at: [-(face + D.capFixed / 2), 0, z(D.capW / 2)], round: 1.5, leaf: 'fixed' },
    { p: 'box', size: [D.capDoor, D.height, D.capW], at: [-(face + D.capDoor / 2), 0, z(D.total - D.capW / 2)], round: 1.5, leaf: 'door' },
    // втулки в отверстиях стекла — видны сквозь него
    ...[1, -1].flatMap(s => [
      { p: 'cyl' as const, d: D.hole - 2, len: D.glass + 1, axis: 'x' as const, at: [0, (s * D.holePitch) / 2, z(holeFixed)] as [number, number, number], leaf: 'fixed' as const },
      { p: 'cyl' as const, d: D.hole - 2, len: D.glass + 1, axis: 'x' as const, at: [0, (s * D.holePitch) / 2, z(holeDoor)] as [number, number, number], leaf: 'door' as const },
    ]),
  ],
  mount: {
    on: 'glass-edge',
    standoff: 0,
    glassMm: [8, 10],
  },
}
