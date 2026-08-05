// Параметрический каталог перегородок — источник правды для конфигуратора партнёра.
// Оцифровка каталога «Комплектации перегородок»: типы, реальные артикулы фурнитуры,
// финиши и правила пересчёта фурнитуры/стекла от размеров (ширина/высота редактируемы).
// Цены здесь НЕ считаются — берутся из shower_standard_hardware / calculateShower.

// ── Финиши (совпадают с shower_hw_colors в базе) ──────────────────
export type FinishId =
  'chrome'|'satin'|'black'|'gunmetal'|'bronze'|'gold'|'brgold'|'white'|'rose'|'brrose'

export type Finish = { id: FinishId; label: string; db: string; hex: string }

export const FINISHES: Finish[] = [
  { id: 'chrome',   label: 'Хром',                    db: 'ХРОМ',            hex: '#c9ccd0' },
  { id: 'satin',    label: 'Хром матовый',            db: 'ХРОМ МАТОВЫЙ',    hex: '#b7babe' },
  { id: 'black',    label: 'Чёрный матовый',          db: 'ЧЕРНЫЙ МАТОВЫЙ',  hex: '#2a2a2c' },
  { id: 'gunmetal', label: 'Оружейная сталь',         db: 'ОРУЖЕЙНАЯ СТАЛЬ', hex: '#3f4548' },
  { id: 'bronze',   label: 'Бронза',                  db: 'БРОНЗА',          hex: '#7a5a3a' },
  { id: 'gold',     label: 'Золото',                  db: 'ЗОЛОТОЙ',         hex: '#c8a24a' },
  { id: 'brgold',   label: 'Матовое золото',          db: 'МАТОВОЕ ЗОЛОТО',  hex: '#b8985a' },
  { id: 'white',    label: 'Белый',                   db: 'БЕЛЫЙ',           hex: '#eeeeea' },
  { id: 'rose',     label: 'Розовое золото',          db: 'Polish Rose gold', hex: '#c99a86' },
  { id: 'brrose',   label: 'Матовое розовое золото',  db: 'BrRose gold',     hex: '#bb9488' },
]

// ── Каталог фурнитуры (реальные артикулы, категории = shower_standard_hardware) ──
export type HardwareCategory =
  'петли'|'ручки'|'профили'|'штанги'|'комплектующие'|'уплотнители'|'доп'

export type Hardware = {
  code: string
  name: string
  category: HardwareCategory
  unit: 'шт'|'м.п.'|'компл.'
  colorable: boolean        // доступна в финишах
  forThicknessMm?: number   // ограничение по толщине стекла
}

export const HARDWARE: Record<string, Hardware> = {
  'Balge-004': { code: 'Balge-004', name: 'Петля стекло-стекло 135°–180°', category: 'петли',        unit: 'шт',    colorable: true },
  'Pr-002':    { code: 'Pr-002',    name: 'П-образный профиль 18×12,5',     category: 'профили',      unit: 'м.п.',  colorable: true, forThicknessMm: 8 },
  'SD-210':    { code: 'SD-210/L230', name: 'Ручка-скоба L230',             category: 'ручки',        unit: 'шт',    colorable: true },
  'KU-002':    { code: 'КУ-002',    name: 'Ручка-купе',                     category: 'ручки',        unit: 'шт',    colorable: true },
  'RD-001':    { code: 'РД-001',    name: 'Раздвижная система Hip System 30×10', category: 'комплектующие', unit: 'компл.', colorable: true },
  'BAR-30x10': { code: 'Штанга 30×10', name: 'Комплект штанги 30×10',       category: 'штанги',       unit: 'компл.', colorable: true },
  'BAR-30x15': { code: 'Штанга 30×15', name: 'Несущая штанга 30×15',        category: 'штанги',       unit: 'м.п.',  colorable: true },
  'Munich-001':{ code: 'Munich-001', name: 'Стабилизационная штанга',       category: 'штанги',       unit: 'компл.', colorable: true },
  'HOLDER':    { code: 'Держатель', name: 'Держатель штанги стена/стекло',   category: 'комплектующие', unit: 'шт',   colorable: true },
  'CONN':      { code: 'Соединитель', name: 'Соединитель профиля/штанги',    category: 'комплектующие', unit: 'шт',   colorable: true },
  'SEAL':      { code: 'Уплотнитель', name: 'Уплотнитель магнитный/лепестковый', category: 'уплотнители', unit: 'м.п.', colorable: false },
  'MAGNET':    { code: 'Магнит', name: 'Магнит 90°/180°',                    category: 'доп',          unit: 'шт',    colorable: false },
  'CAP':       { code: 'Заглушка', name: 'Заглушка',                         category: 'доп',          unit: 'шт',    colorable: true },
}

// ── Размеры (редактируемые пользователем) ─────────────────────────
export type Dims = {
  width: number       // основной проём, мм
  width2?: number     // вторая сторона (угловые / трапеция), мм
  height: number      // высота, мм
  doorWidth?: number  // ширина двери, мм (по умолчанию 600)
}

export type Panel = { key: string; role: 'fixed'|'door'|'return'; w: number; h: number }
export type BomItem = { code: string; name: string; category: HardwareCategory; qty: number; unit: string }

// ── Типы перегородок ──────────────────────────────────────────────
export type PartitionGroup = 'swing'|'sliding'|'screen'|'stationary'
export type PartitionTypeId =
  'stationary'|'straight-swing'|'straight-sliding'|'trapezoid'|
  'corner-swing'|'corner-sliding'|'bath-screen'|'bath-screen-swing'

export type Constraints = {
  width:  [number, number]
  width2?: [number, number]
  height: [number, number]
  needsWidth2: boolean
  doorWidth?: [number, number]
}

export type PartitionType = {
  id: PartitionTypeId
  label: string
  group: PartitionGroup
  desc: string
  thickness: number[]        // допустимые толщины стекла, мм
  constraints: Constraints
  panels: (d: Dims) => Panel[]
  bom: (d: Dims) => BomItem[]
}

const hinges = (h: number) => (h <= 1950 ? 2 : 3)
const mp = (mm: number) => Math.round(mm) / 1000            // мм → м.п.
const item = (code: keyof typeof HARDWARE | string, qty: number): BomItem => {
  const hw = HARDWARE[code]
  return { code: hw.code, name: hw.name, category: hw.category, qty: Number(qty.toFixed(2)), unit: hw.unit }
}
const door = (d: Dims) => d.doorWidth ?? 600

export const PARTITION_TYPES: PartitionType[] = [
  {
    id: 'stationary', label: 'Стационарная (walk-in)', group: 'stationary',
    desc: 'Неподвижная панель на профиле + стабилизационная штанга',
    thickness: [8, 10],
    constraints: { width: [500, 1400], height: [1800, 2200], needsWidth2: false },
    panels: d => [{ key: 'fixed', role: 'fixed', w: d.width, h: d.height }],
    bom: d => [
      item('Pr-002', mp(d.height + d.width)),
      item('BAR-30x10', 1),
      item('HOLDER', 2),
      item('SEAL', mp(d.width)),
    ],
  },
  {
    id: 'straight-swing', label: 'Прямая распашная', group: 'swing',
    desc: 'Неподвижная панель + распашная дверь на петлях стекло-стекло',
    thickness: [8, 10],
    constraints: { width: [700, 1600], height: [1800, 2100], needsWidth2: false, doorWidth: [500, 800] },
    panels: d => {
      const dw = door(d)
      return [
        { key: 'fixed', role: 'fixed', w: Math.max(0, d.width - dw), h: d.height },
        { key: 'door',  role: 'door',  w: dw, h: d.height },
      ]
    },
    bom: d => {
      const dw = door(d)
      return [
        item('Balge-004', hinges(d.height)),
        item('SD-210', 1),
        item('Pr-002', mp(d.height + (d.width - dw))),
        item('BAR-30x10', 1),
        item('HOLDER', 2),
        item('SEAL', mp(d.height)),
        item('MAGNET', 1),
      ]
    },
  },
  {
    id: 'straight-sliding', label: 'Прямая раздвижная', group: 'sliding',
    desc: 'Неподвижная панель + раздвижная дверь на системе РД-001',
    thickness: [8, 10],
    constraints: { width: [900, 1800], height: [1800, 2100], needsWidth2: false },
    panels: d => {
      const half = Math.round(d.width * 0.55)
      return [
        { key: 'fixed', role: 'fixed', w: half, h: d.height },
        { key: 'door',  role: 'door',  w: half, h: d.height },
      ]
    },
    bom: d => [
      item('RD-001', 1),
      item('KU-002', 1),
      item('BAR-30x15', mp(d.width)),
      item('Pr-002', mp(d.height + Math.round(d.width * 0.55))),
      item('SEAL', mp(d.height * 2)),
      item('CAP', 4),
    ],
  },
  {
    id: 'trapezoid', label: 'Трапеция распашная', group: 'swing',
    desc: 'Трапециевидная неподвижная панель + распашная дверь',
    thickness: [8, 10],
    constraints: {
      width: [700, 1600], width2: [300, 1400], height: [1800, 2100],
      needsWidth2: true, doorWidth: [500, 800],
    },
    panels: d => {
      const dw = door(d)
      return [
        { key: 'fixed', role: 'fixed', w: Math.max(0, d.width - dw), h: d.height },
        { key: 'door',  role: 'door',  w: dw, h: d.height },
      ]
    },
    bom: d => {
      const dw = door(d)
      return [
        item('Balge-004', hinges(d.height)),
        item('SD-210', 1),
        item('Pr-002', mp(d.height + (d.width - dw) + (d.width2 ?? 0))),
        item('BAR-30x10', 1),
        item('HOLDER', 2),
        item('SEAL', mp(d.height)),
        item('MAGNET', 1),
      ]
    },
  },
  {
    id: 'corner-swing', label: 'Угловая распашная', group: 'swing',
    desc: 'Две стороны: боковая панель + фронтальная панель с распашной дверью',
    thickness: [8, 10],
    constraints: {
      width: [700, 1400], width2: [500, 1200], height: [1800, 2100],
      needsWidth2: true, doorWidth: [500, 800],
    },
    panels: d => {
      const dw = door(d)
      return [
        { key: 'return', role: 'return', w: d.width2 ?? 0, h: d.height },
        { key: 'fixed',  role: 'fixed',  w: Math.max(0, d.width - dw), h: d.height },
        { key: 'door',   role: 'door',   w: dw, h: d.height },
      ]
    },
    bom: d => [
      item('Balge-004', hinges(d.height) + 1),   // +1 угловое соединение стекло-стекло
      item('SD-210', 1),
      item('Pr-002', mp(d.height * 2 + d.width + (d.width2 ?? 0))),
      item('BAR-30x10', 1),
      item('HOLDER', 2),
      item('SEAL', mp(d.height)),
      item('MAGNET', 1),
    ],
  },
  {
    id: 'corner-sliding', label: 'Угловая раздвижная', group: 'sliding',
    desc: 'Две стороны с раздвижными дверями на системе РД-001',
    thickness: [8, 10],
    constraints: {
      width: [900, 1500], width2: [900, 1500], height: [1800, 2100], needsWidth2: true,
    },
    panels: d => [
      { key: 'sideA', role: 'door',  w: Math.round(d.width * 0.55), h: d.height },
      { key: 'fixedA', role: 'fixed', w: Math.round(d.width * 0.55), h: d.height },
      { key: 'sideB', role: 'door',  w: Math.round((d.width2 ?? 0) * 0.55), h: d.height },
      { key: 'fixedB', role: 'fixed', w: Math.round((d.width2 ?? 0) * 0.55), h: d.height },
    ],
    bom: d => [
      item('RD-001', 2),
      item('KU-002', 2),
      item('BAR-30x15', mp(d.width + (d.width2 ?? 0))),
      item('Pr-002', mp(d.height * 2)),
      item('CONN', 1),
      item('SEAL', mp(d.height * 2)),
      item('CAP', 8),
    ],
  },
  {
    id: 'bath-screen', label: 'Шторка на ванну', group: 'screen',
    desc: 'Неподвижная шторка на борт ванны со стабилизатором Munich-001',
    thickness: [8],
    constraints: { width: [400, 1200], height: [1200, 1600], needsWidth2: false },
    panels: d => [{ key: 'fixed', role: 'fixed', w: d.width, h: d.height }],
    bom: d => [
      item('Pr-002', mp(d.height + d.width)),
      item('Munich-001', 1),
      item('SEAL', mp(d.width)),
    ],
  },
  {
    id: 'bath-screen-swing', label: 'Шторка на ванну распашная', group: 'screen',
    desc: 'Неподвижная часть + распашная секция на петле Balge-004',
    thickness: [8],
    constraints: { width: [700, 1400], height: [1200, 1600], needsWidth2: false, doorWidth: [350, 600] },
    panels: d => {
      const dw = door(d)
      return [
        { key: 'fixed', role: 'fixed', w: Math.max(0, d.width - dw), h: d.height },
        { key: 'door',  role: 'door',  w: dw, h: d.height },
      ]
    },
    bom: d => {
      const dw = door(d)
      return [
        item('Balge-004', hinges(d.height)),
        item('Pr-002', mp(d.height + (d.width - dw))),
        item('Munich-001', 1),
        item('SEAL', mp(d.height)),
        item('MAGNET', 1),
      ]
    },
  },
]

export function getType(id: PartitionTypeId): PartitionType {
  const t = PARTITION_TYPES.find(t => t.id === id)
  if (!t) throw new Error(`Неизвестный тип перегородки: ${id}`)
  return t
}

// ── Итоговая конфигурация от размеров (ядро «редактируемого» каталога) ──
export type Configuration = {
  type: PartitionType
  dims: Dims
  thickness: number
  finish: Finish
  panels: Panel[]
  glassAreaM2: number
  bom: BomItem[]
  warnings: string[]
}

const MAX_SINGLE_PANE_MM = 1100  // ширина одного цельного стекла без секции

export function computeConfiguration(
  typeId: PartitionTypeId,
  dims: Dims,
  thickness: number,
  finishId: FinishId,
): Configuration {
  const type = getType(typeId)
  const finish = FINISHES.find(f => f.id === finishId) ?? FINISHES[0]
  const panels = type.panels(dims)
  const glassAreaM2 = Number(
    panels.reduce((s, p) => s + (p.w * p.h) / 1_000_000, 0).toFixed(2),
  )
  const bom = type.bom(dims)

  const warnings: string[] = []
  const c = type.constraints
  const clampMsg = (name: string, v: number, [min, max]: [number, number]) => {
    if (v < min) warnings.push(`${name} ${v} мм меньше минимума ${min} мм`)
    if (v > max) warnings.push(`${name} ${v} мм больше максимума ${max} мм`)
  }
  clampMsg('Ширина', dims.width, c.width)
  clampMsg('Высота', dims.height, c.height)
  if (c.needsWidth2 && c.width2) clampMsg('Ширина 2', dims.width2 ?? 0, c.width2)
  if (!type.thickness.includes(thickness))
    warnings.push(`Толщина ${thickness} мм недоступна для этого типа`)
  for (const p of panels) {
    if (p.w > MAX_SINGLE_PANE_MM)
      warnings.push(`Секция ${p.w} мм шире одного стекла (${MAX_SINGLE_PANE_MM} мм) — потребуется деление`)
    if (p.role === 'fixed' && p.w < 200 && p.w > 0)
      warnings.push(`Неподвижная секция ${p.w} мм слишком узкая`)
  }

  return { type, dims, thickness, finish, panels, glassAreaM2, bom, warnings }
}
