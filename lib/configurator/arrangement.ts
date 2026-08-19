// Единый источник РАСПОЛОЖЕНИЯ моделей душевых (подтверждено владельцем).
// Одна раскладка периметра → и вид сверху (схема), и 3D-сборка. Правило:
// дверь крепится петлёй туда, что стоит с её петлевой стороны — к стеклу или к стене.
// Все распашные двери открываются НАРУЖУ. Набор: М1,М2,М4,М7,М8,М9,М10,М12,М11.

export type SegType = 'fixed' | 'door' | 'slide'
// hinge: 'a' — петля у начала сегмента (со стороны стенового конца run), 'b' — у конца.
export type Seg = { t: SegType; hinge?: 'a' | 'b' }
export type RunEdge = 'front' | 'side'
export type Run = { edge: RunEdge; segs: Seg[]; part?: number }
export type Shape = 'walkin' | 'niche' | 'corner' | 'trap'

export type MConstraints = {
  width: [number, number]
  width2?: [number, number]
  height: [number, number]
  needsWidth2: boolean
  doorWidth?: [number, number]
}

export type MModel = {
  code: string
  name: string
  shape: Shape
  group: 'stationary' | 'swing' | 'sliding'
  desc: string
  runs: Run[]
  thickness: number[]
  constraints: MConstraints
}

const H: [number, number] = [1800, 2200]

export const M_MODELS: MModel[] = [
  {
    code: 'М1', name: 'Стационарная', shape: 'walkin', group: 'stationary',
    desc: 'Одна панель у стены, вход открыт (walk-in).',
    runs: [{ edge: 'front', segs: [{ t: 'fixed' }], part: 0.62 }],
    thickness: [8, 10], constraints: { width: [500, 1400], height: [1800, 2200], needsWidth2: false },
  },
  {
    code: 'М2', name: 'Прямая распашная', shape: 'niche', group: 'swing',
    desc: 'Неподвижное + распашная дверь наружу, петля на стекле.',
    runs: [{ edge: 'front', segs: [{ t: 'fixed' }, { t: 'door', hinge: 'a' }] }],
    thickness: [8, 10], constraints: { width: [700, 1600], height: H, needsWidth2: false, doorWidth: [500, 800] },
  },
  {
    code: 'М4', name: 'Прямая: стекло-дверь-стекло', shape: 'niche', group: 'swing',
    desc: 'Дверь по центру, петля и притвор на стекле.',
    runs: [{ edge: 'front', segs: [{ t: 'fixed' }, { t: 'door', hinge: 'a' }, { t: 'fixed' }] }],
    thickness: [8, 10], constraints: { width: [1000, 2000], height: H, needsWidth2: false, doorWidth: [500, 800] },
  },
  {
    code: 'М7', name: 'Угловая распашная', shape: 'corner', group: 'swing',
    desc: 'Стационар у стены + дверь на нём; наружу, притвор к перпендикулярному стеклу.',
    runs: [
      { edge: 'side', segs: [{ t: 'fixed' }] },
      { edge: 'front', segs: [{ t: 'fixed' }, { t: 'door', hinge: 'a' }] },
    ],
    thickness: [8, 10], constraints: { width: [700, 1400], width2: [500, 1200], height: H, needsWidth2: true, doorWidth: [500, 800] },
  },
  {
    code: 'М8', name: 'Угловая раздвижная', shape: 'corner', group: 'sliding',
    desc: 'Два стационара у стен, две раздвижные створки съезжаются к углу.',
    runs: [
      { edge: 'side', segs: [{ t: 'fixed' }, { t: 'slide' }] },
      { edge: 'front', segs: [{ t: 'fixed' }, { t: 'slide' }] },
    ],
    thickness: [8, 10], constraints: { width: [900, 1500], width2: [900, 1500], height: H, needsWidth2: true },
  },
  {
    code: 'М9', name: 'Угловая раздвижная', shape: 'corner', group: 'sliding',
    desc: 'Стационары у створок; раздвижная едет вдоль стекла и приходит перпендикулярно к другому.',
    runs: [
      { edge: 'side', segs: [{ t: 'fixed' }] },
      { edge: 'front', segs: [{ t: 'fixed' }, { t: 'slide' }] },
    ],
    thickness: [8, 10], constraints: { width: [900, 1500], width2: [700, 1300], height: H, needsWidth2: true },
  },
  {
    code: 'М10', name: 'Прямая раздвижная', shape: 'niche', group: 'sliding',
    desc: 'Неподвижное + раздвижная дверь (РД-001).',
    runs: [{ edge: 'front', segs: [{ t: 'fixed' }, { t: 'slide' }] }],
    thickness: [8, 10], constraints: { width: [900, 1800], height: H, needsWidth2: false },
  },
  {
    code: 'М12', name: 'Прямая раздвижная (центр)', shape: 'niche', group: 'sliding',
    desc: 'Два стационара у стен, центральная створка откатывается влево или вправо.',
    runs: [{ edge: 'front', segs: [{ t: 'fixed' }, { t: 'slide' }, { t: 'fixed' }] }],
    thickness: [8, 10], constraints: { width: [1200, 2000], height: H, needsWidth2: false },
  },
  {
    code: 'М11', name: 'Трапеция (пятигранник)', shape: 'trap', group: 'swing',
    desc: 'Срезанный угол: диагональное стекло под 135°, на нём дверь (петля стекло-стекло).',
    // Пятигранник строится по фикс-правилам shape='trap'; runs здесь только для двери.
    runs: [{ edge: 'front', segs: [{ t: 'fixed' }, { t: 'door', hinge: 'a' }, { t: 'fixed' }] }],
    thickness: [8, 10], constraints: { width: [700, 1400], width2: [700, 1400], height: H, needsWidth2: true, doorWidth: [450, 700] },
  },
]

export function getModel(code: string): MModel {
  const m = M_MODELS.find(x => x.code === code)
  if (!m) throw new Error(`Неизвестная модель: ${code}`)
  return m
}

// К чему крепится дверь: 'стекло' | 'стена' | null (нет распашной двери).
export function doorAttachment(m: MModel): 'стекло' | 'стена' | null {
  if (m.shape === 'trap') return 'стекло'
  for (const r of m.runs) {
    for (let i = 0; i < r.segs.length; i++) {
      const sg = r.segs[i]
      if (sg.t !== 'door') continue
      const nb = sg.hinge === 'a' ? (i > 0 ? r.segs[i - 1] : null) : (i < r.segs.length - 1 ? r.segs[i + 1] : null)
      if (nb) return 'стекло'
      return m.shape === 'corner' && r.edge === 'front' && i === 0 ? 'стекло' : 'стена'
    }
  }
  return null
}
