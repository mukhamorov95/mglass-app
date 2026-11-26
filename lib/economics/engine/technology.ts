import { plus, point, times, ZERO, type Range } from '../classification/vat'
import type { Reader } from './reference'

// Физическое потребление ресурсов: человеко-минуты и станко-минуты раздельно, наладка отдельно
// и один раз на технологическую партию. Денег здесь нет. Чего нет в нормах, не подставляется:
// оно попадает в перечень неучтённого.
export type EdgeMode = 'grind' | 'polish' | 'unknown' | 'none'
export type Marking = 'manual' | 'template' | 'unknown'
export type SandMode = 'standard' | 'dense' | 'enhanced' | 'unknown'

export type PartSpec = {
  key: string
  materialKey: string | null
  thicknessMm: number | null
  widthMm: number | null
  heightMm: number | null
  qty: number
  layers?: number
  shape: 'rect' | 'curved'
  edge: EdgeMode
  holes: { diameterMm: number | null; perPart: number }[]
  holesUncounted?: boolean
  marking: Marking
  cutouts: { type: string | null; perPart: number }[]
  cutoutsUncounted?: boolean
  tempering: boolean
  sandblast: { m2PerPart: number | null; mode: SandMode } | null
  packaging: boolean
  frame?: { welding: boolean; assembly: boolean }
}

// detailed — только подробные нормы (нижняя граница там, где цикл неполон);
// with_coarse — там, где подробной нормы нет или она неполна, берётся грубый сценарий переноса.
export type TechProfile = 'detailed' | 'with_coarse'

export type CenterId = 'cutting' | 'edge' | 'drilling' | 'curved' | 'sandblast' | 'packaging' | 'assembly' | 'welding'
export const CENTER_LABEL: Record<CenterId, string> = {
  cutting: 'Резка', edge: 'Прямолинейная кромка', drilling: 'Сверление', curved: 'Фигурная обработка и вырезы',
  sandblast: 'Пескоструй', packaging: 'Упаковка', assembly: 'Сборка', welding: 'Сварка',
}
export const MACHINE_LABEL: Partial<Record<CenterId, string>> = {
  edge: 'ZM-9', drilling: 'JD-22', curved: 'JYM-1', sandblast: 'JP-1600',
}

export type OpKind = 'cutting' | 'edge' | 'curved' | 'drilling' | 'cutout' | 'sandblast' | 'packaging' | 'welding' | 'assembly'

export type OpLine = {
  partKey: string
  op: OpKind
  center: CenterId
  batchKey: string
  parts: number
  qty: number
  unit: 'листов' | 'м.п.' | 'отв.' | 'вырезов' | 'м²' | 'дет.'
  labourMin: Range
  machineMin: Range
  formula: string
  refKeys: string[]
}
export type Setup = { op: OpKind; center: CenterId; batchKey: string; labourMin: Range; machineMin: Range; refKeys: string[] }
export type Missing = { partKey: string | null; op: OpKind | 'material' | 'tempering' | 'general'; what: string }

const MIN = 60
const fmt = (r: Range) => r.lo === r.hi ? String(Math.round(r.lo * 100) / 100) : `${Math.round(r.lo * 100) / 100}…${Math.round(r.hi * 100) / 100}`

export const perimeterM = (p: PartSpec) => (p.widthMm && p.heightMm ? 2 * (p.widthMm + p.heightMm) / 1000 : 0)
export const areaM2 = (p: PartSpec) => (p.widthMm && p.heightMm ? p.widthMm * p.heightMm / 1_000_000 : 0)

export const ZM9_ROWS = [4, 5, 6, 8, 10, 12, 15, 19]
const zm9Row = (t: number | null) => (t == null ? null : t >= 3 && t <= 4 ? 4 : ZM9_ROWS.includes(t) ? t : null)

export const DRILL_BANDS: [number, number][] = [[4, 12], [13, 25], [26, 40], [41, 60], [61, 80], [81, 100]]
// Промежуточные диаметры (12,5) относятся к следующему диапазону; ниже наименьшего диапазона нет.
export const drillBand = (d: number) => {
  const b = DRILL_BANDS.find(([, hi]) => d <= hi)
  return b && d >= DRILL_BANDS[0][0] ? `${b[0]}-${b[1]}` : null
}
export const CUTOUT_TYPES = ['angle', 'rect', 'hinge', 'cheburashka', 'socket', 'complex'] as const

type Ctx = {
  ref: Reader
  profile: TechProfile
  ops: OpLine[]
  setups: Map<string, Setup>
  missing: Missing[]
}

const miss = (c: Ctx, p: PartSpec | null, op: Missing['op'], what: string) => {
  if (!c.missing.some(m => m.partKey === (p?.key ?? null) && m.op === op && m.what === what)) {
    c.missing.push({ partKey: p?.key ?? null, op, what })
  }
}

// Наладка принадлежит партии, а не детали: одинаковый ключ — одна наладка.
function setup(c: Ctx, op: OpKind, center: CenterId, batchKey: string, key: string, onMachine: boolean, p: PartSpec) {
  const id = `${op}|${batchKey}`
  if (c.setups.has(id)) return
  const v = c.ref.get(key)
  if (!v) { miss(c, p, op, `наладка партии: нет нормы (${CENTER_LABEL[center]})`); return }
  c.setups.set(id, { op, center, batchKey, labourMin: v, machineMin: onMachine ? v : ZERO, refKeys: [key] })
}

function line(c: Ctx, p: PartSpec, o: Omit<OpLine, 'partKey'>) {
  c.ops.push({ partKey: p.key, ...o })
}

function cutting(c: Ctx, p: PartSpec, n: number) {
  const perSheet = c.ref.get('cut.minPerSheet'), refParts = c.ref.get('cut.partsPerSheet'), sheet = c.ref.get('sheet.areaM2')
  if (!perSheet || !refParts || !sheet) { miss(c, p, 'cutting', 'нет нормы резки листа'); return }
  const waste = (p.materialKey ? c.ref.get(`mat.${p.materialKey}.waste`) : null) ?? point(0)
  const net = areaM2(p) * n
  // Норма дана на контрольный лист из 9 деталей. Лист мелких деталей режется дольше, насколько —
  // не измерено: низ считает по площади, верх по числу деталей.
  const byArea = { lo: net * (1 + waste.lo / 100) / sheet.lo, hi: net * (1 + waste.hi / 100) / sheet.hi }
  const byParts = n / refParts.lo
  const sheets = { lo: byArea.lo, hi: Math.max(byArea.hi, byParts) }
  const minutes = { lo: sheets.lo * perSheet.lo, hi: sheets.hi * perSheet.hi }
  line(c, p, { op: 'cutting', center: 'cutting', batchKey: `${p.materialKey ?? '?'}:${p.thicknessMm ?? '?'}`, parts: n,
    qty: Math.round(byArea.hi * 1000) / 1000, unit: 'листов', labourMin: minutes, machineMin: ZERO,
    formula: `листы ${fmt(sheets)} × ${fmt(perSheet)} мин`, refKeys: ['cut.minPerSheet', 'cut.partsPerSheet', 'sheet.areaM2'] })
}

function edge(c: Ctx, p: PartSpec, n: number) {
  const row = zm9Row(p.thicknessMm)
  const metres = perimeterM(p) * n
  if (row == null) { miss(c, p, 'edge', `ZM-9: нет нормы для толщины ${p.thicknessMm ?? 'не указана'}`); return }
  const batchKey = `${row}:${p.edge}`
  const operators = c.ref.get('zm9.operators') ?? point(1)
  if (c.profile === 'with_coarse') {
    const rate = c.ref.get(`zm9.fullcycle.${row}`)
    if (rate) {
      const minutes = { lo: metres / rate.hi * MIN, hi: metres / rate.lo * MIN }
      setup(c, 'edge', 'edge', batchKey, 'zm9.setupMin', true, p)
      line(c, p, { op: 'edge', center: 'edge', batchKey, parts: n, qty: metres, unit: 'м.п.',
        labourMin: { lo: minutes.lo * operators.lo, hi: minutes.hi * operators.hi }, machineMin: minutes,
        formula: `${fmt(point(metres))} м ÷ ${fmt(rate)} м/ч (грубый полный цикл, вместо скорости подачи)`,
        refKeys: [`zm9.fullcycle.${row}`, 'zm9.operators'] })
      return
    }
  }
  const modes = p.edge === 'unknown' ? ['grind', 'polish'] : [p.edge]
  const speed = c.ref.span(modes.map(m => `zm9.${m}.${row}`))
  if (!speed) { miss(c, p, 'edge', `ZM-9: нет скорости подачи для ${row} мм`); return }
  if (p.edge === 'unknown') miss(c, p, 'edge', 'тип кромки не записан: диапазон от шлифовки до полировки')
  const feed = { lo: metres / speed.hi, hi: metres / speed.lo }
  const handling = c.ref.get('zm9.handlingMinPerPart')
  if (!handling) miss(c, p, 'edge', 'ZM-9: загрузка, повороты, выгрузка и контроль не учтены (время только по скорости подачи)')
  const handled = handling ? times(handling, n) : ZERO
  setup(c, 'edge', 'edge', batchKey, 'zm9.setupMin', true, p)
  const machine = plus(feed, handled)
  line(c, p, { op: 'edge', center: 'edge', batchKey, parts: n, qty: metres, unit: 'м.п.',
    labourMin: { lo: machine.lo * operators.lo, hi: machine.hi * operators.hi }, machineMin: machine,
    formula: `${fmt(point(metres))} м ÷ подача ${fmt(speed)} м/мин${handling ? ` + ${n} дет. × ${fmt(handling)} мин` : ''}`,
    refKeys: [...modes.map(m => `zm9.${m}.${row}`), 'zm9.operators'] })
}

function curved(c: Ctx, p: PartSpec, n: number) {
  const metres = perimeterM(p) * n
  const rate = c.profile === 'with_coarse' ? c.ref.get('jym.coarsePartsPerHour') : null
  if (!rate) { miss(c, p, 'curved', 'фигурная кромка: подробной нормы нет, время не учтено'); return }
  const minutes = { lo: n / rate.hi * MIN, hi: n / rate.lo * MIN }
  miss(c, p, 'curved', 'фигурная кромка: только грубый сценарий «деталей в час»; периметр взят по габариту')
  line(c, p, { op: 'curved', center: 'curved', batchKey: `${p.thicknessMm ?? '?'}`, parts: n, qty: metres, unit: 'м.п.',
    labourMin: minutes, machineMin: minutes, formula: `${n} дет. ÷ ${fmt(rate)} дет./ч`, refKeys: ['jym.coarsePartsPerHour'] })
}

function drilling(c: Ctx, p: PartSpec, n: number) {
  if (p.holesUncounted) miss(c, p, 'drilling', 'отверстия отмечены без количества: сверление не посчитано')
  const holes = p.holes.filter(h => h.perPart > 0)
  if (!holes.length) return
  const group = p.thicknessMm == null ? null : c.ref.get(`jd22.group.${p.thicknessMm}`)
  const groups = group ? [group.lo] : [1, 2, 3, 4, 5]
  const max = c.ref.get('jd22.maxDiameter')
  let drillSec: Range = ZERO, count = 0
  const keys: string[] = []
  for (const h of holes) {
    if (h.diameterMm != null && max && h.diameterMm > max.hi) {
      miss(c, p, 'drilling', `Ø${h.diameterMm} мм больше паспортного диаметра JD-22: способ и время не заданы`)
      continue
    }
    const band = h.diameterMm == null ? null : drillBand(h.diameterMm)
    if (h.diameterMm != null && !band) { miss(c, p, 'drilling', `Ø${h.diameterMm} мм вне таблицы норм`); continue }
    if (h.diameterMm == null) miss(c, p, 'drilling', 'диаметр отверстия не указан: диапазон по всей таблице')
    const bands = band ? [band] : DRILL_BANDS.filter(([lo]) => !max || lo <= max.hi).map(([a, b]) => `${a}-${b}`)
    const cols = bands.flatMap(b => groups.map(g => `jd22.sec.${b}.g${g}`))
    const sec = c.ref.span(cols)
    if (!sec) { miss(c, p, 'drilling', 'JD-22: нет времени сверления'); continue }
    keys.push(...cols)
    drillSec = plus(drillSec, times(sec, h.perPart * n))
    count += h.perPart * n
  }
  if (!count) return
  if (!group) miss(c, p, 'drilling', 'группа толщины JD-22 не сопоставлена: диапазон по всем пяти группам')
  const load = c.ref.get('jd22.loadSecPerPart')
  if (!load) miss(c, p, 'drilling', 'JD-22: загрузка детали не учтена')
  miss(c, p, 'drilling', 'JD-22: выгрузка не учтена')
  const markKeys = p.marking === 'unknown' ? ['jd22.mark.manualSec', 'jd22.mark.templateSec'] : [`jd22.mark.${p.marking}Sec`]
  const mark = c.ref.span(markKeys)
  if (!mark) miss(c, p, 'drilling', 'JD-22: разметка не учтена')
  const loadSec = load ? times(load, n) : ZERO
  const markSec = mark ? times(mark, count) : ZERO
  const batchKey = `${p.thicknessMm ?? '?'}:${holes.map(h => h.diameterMm ?? '?').sort().join('+')}`
  setup(c, 'drilling', 'drilling', batchKey, 'jd22.setupMin', true, p)
  line(c, p, { op: 'drilling', center: 'drilling', batchKey, parts: n, qty: count, unit: 'отв.',
    labourMin: times(plus(loadSec, markSec, drillSec), 1 / MIN), machineMin: times(plus(loadSec, drillSec), 1 / MIN),
    formula: `(загрузка ${fmt(loadSec)} с + разметка ${fmt(markSec)} с + сверление ${fmt(drillSec)} с) ÷ 60`,
    refKeys: [...keys, 'jd22.loadSecPerPart', ...markKeys] })
}

function cutouts(c: Ctx, p: PartSpec, n: number) {
  if (p.cutoutsUncounted) miss(c, p, 'cutout', 'вырезы отмечены без количества: не посчитаны')
  const cuts = p.cutouts.filter(x => x.perPart > 0)
  if (!cuts.length) return
  const coef = (p.thicknessMm == null ? null : c.ref.get(`jym.thk.${p.thicknessMm}`)) ?? c.ref.span(c.ref.keys('jym.thk.'))
  if (!coef) { miss(c, p, 'cutout', 'JYM-1: нет коэффициентов толщины'); return }
  if (p.thicknessMm == null || !c.ref.get(`jym.thk.${p.thicknessMm}`)) {
    miss(c, p, 'cutout', `JYM-1: коэффициент для толщины ${p.thicknessMm ?? '?'} мм не задан: диапазон по крайним`)
  }
  let cutMin: Range = ZERO, count = 0
  for (const x of cuts) {
    const keys = x.type && c.ref.get(`jym.cut.${x.type}`) ? [`jym.cut.${x.type}`] : CUTOUT_TYPES.map(t => `jym.cut.${t}`)
    if (keys.length > 1) miss(c, p, 'cutout', 'тип выреза не сопоставлен с таблицей: диапазон по всем типам')
    const base = c.ref.span(keys)
    if (!base) { miss(c, p, 'cutout', 'JYM-1: нет времени выреза'); continue }
    cutMin = plus(cutMin, { lo: base.lo * coef.lo * x.perPart * n, hi: base.hi * coef.hi * x.perPart * n })
    count += x.perPart * n
  }
  if (!count) return
  miss(c, p, 'cutout', 'не подтверждено, какие вырезы делает JYM-1, а какие ручной инструмент')
  const move = plus(c.ref.get('jym.loadMin') ?? ZERO, c.ref.get('jym.unloadMin') ?? ZERO)
  const control = c.ref.get('jym.controlMin') ?? ZERO
  const mark = c.ref.get('jym.markMin') ?? ZERO
  const batchKey = `${p.thicknessMm ?? '?'}`
  setup(c, 'cutout', 'curved', batchKey, 'jym.setupMin', true, p)
  line(c, p, { op: 'cutout', center: 'curved', batchKey, parts: n, qty: count, unit: 'вырезов',
    labourMin: plus(cutMin, times(plus(move, control, mark), n)), machineMin: plus(cutMin, times(move, n)),
    formula: `вырезы ${fmt(cutMin)} мин + ${n} дет. × (загрузка и выгрузка ${fmt(move)} + контроль ${fmt(control)} + разметка ${fmt(mark)})`,
    refKeys: ['jym.loadMin', 'jym.unloadMin', 'jym.controlMin', 'jym.markMin'] })
}

function sandblast(c: Ctx, p: PartSpec, n: number) {
  if (!p.sandblast) return
  const m2 = (p.sandblast.m2PerPart ?? areaM2(p)) * n
  if (p.sandblast.m2PerPart == null) miss(c, p, 'sandblast', 'площадь пескоструя не указана: взята площадь детали')
  const modes = p.sandblast.mode === 'unknown' ? ['standard', 'dense', 'enhanced'] : [p.sandblast.mode]
  const rate = c.ref.span(modes.map(m => `jp.m2h.${m}`))
  if (!rate) { miss(c, p, 'sandblast', 'JP-1600: нет производительности'); return }
  if (p.sandblast.mode === 'unknown') miss(c, p, 'sandblast', 'режим пескоструя не указан: диапазон по режимам')
  if (!c.ref.get('jp.filmMinPerM2')) miss(c, p, 'sandblast', 'плёнка и трафарет: труд не учтён')
  const minutes = { lo: m2 / rate.hi * MIN, hi: m2 / rate.lo * MIN }
  setup(c, 'sandblast', 'sandblast', modes.join('+'), 'jp.setupMin', true, p)
  line(c, p, { op: 'sandblast', center: 'sandblast', batchKey: modes.join('+'), parts: n, qty: m2, unit: 'м²',
    labourMin: minutes, machineMin: minutes, formula: `${fmt(point(Math.round(m2 * 100) / 100))} м² ÷ ${fmt(rate)} м²/ч`,
    refKeys: modes.map(m => `jp.m2h.${m}`) })
}

function packaging(c: Ctx, p: PartSpec, n: number) {
  const per = c.ref.get('pack.minPerPart')
  if (!per) { miss(c, p, 'packaging', 'нет нормы труда упаковки'); return }
  line(c, p, { op: 'packaging', center: 'packaging', batchKey: 'all', parts: n, qty: n, unit: 'дет.',
    labourMin: times(per, n), machineMin: ZERO, formula: `${n} дет. × ${fmt(per)} мин`, refKeys: ['pack.minPerPart'] })
}

export function consumption(specs: PartSpec[], ref: Reader, profile: TechProfile) {
  const c: Ctx = { ref, profile, ops: [], setups: new Map(), missing: [] }
  for (const p of specs) {
    if (!(p.qty > 0)) { miss(c, p, 'general', 'нет количества'); continue }
    const sized = !!(p.widthMm && p.heightMm)
    if (!sized) miss(c, p, 'general', 'нет размеров: резка и кромка не посчитаны')
    const layers = p.layers ?? 1
    // Слои пакета режутся, сверлятся и обрабатываются каждый; упаковывается готовое изделие.
    const pieces = p.qty * layers
    if (sized) {
      cutting(c, p, pieces)
      if (p.shape === 'curved') curved(c, p, pieces)
      else if (p.edge !== 'none') edge(c, p, pieces)
      sandblast(c, p, p.qty)
    }
    drilling(c, p, pieces)
    cutouts(c, p, pieces)
    if (p.frame?.welding) miss(c, p, 'welding', 'сварка рамы: нормы нет, труд не учтён')
    if (p.frame?.assembly) miss(c, p, 'assembly', 'сборка: нормы по составу изделия нет, труд не учтён')
    if (p.packaging) packaging(c, p, p.qty)
  }
  return { ops: c.ops, setups: [...c.setups.values()], missing: c.missing }
}
export type Consumption = ReturnType<typeof consumption>

export type Minutes = { labour: Range; machine: Range; setupLabour: Range }
export function minutesByCenter(u: Pick<Consumption, 'ops' | 'setups'>): Partial<Record<CenterId, Minutes>> {
  const out: Partial<Record<CenterId, Minutes>> = {}
  const at = (id: CenterId) => (out[id] ??= { labour: ZERO, machine: ZERO, setupLabour: ZERO })
  for (const o of u.ops) { const m = at(o.center); m.labour = plus(m.labour, o.labourMin); m.machine = plus(m.machine, o.machineMin) }
  for (const s of u.setups) {
    const m = at(s.center)
    m.labour = plus(m.labour, s.labourMin); m.machine = plus(m.machine, s.machineMin); m.setupLabour = plus(m.setupLabour, s.labourMin)
  }
  return out
}
