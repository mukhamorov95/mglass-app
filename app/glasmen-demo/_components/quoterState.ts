// Состояние экрана расчёта без React: черновик в localStorage, разбор DXF один раз на текст,
// решение «показывать ли цену». Отдельно от Quoter.tsx, чтобы проверяться тестами в node.
import { DEFAULT_CUTOUT, DEFAULT_HOLE, HOLE_LAYOUTS, SHAPES, defaultSpec, parseDxf, type CutoutGroup, type DxfUnit, type HoleGroup, type PartGeometry, type PartSpec } from '@/lib/glasmen'
import type { ModelId, ParamsOverride } from './api'
import { MODEL_IDS, plural } from './api'
import type { CartItem } from './MiniCart'
import type { Kind } from './groupMaterials'

// Деталь задаётся шагами формы или чертежом DXF (тогда размеры, форма и отверстия — из файла).
export type Source = 'form' | 'dxf'
export type Dxf = { text: string; name: string; units: DxfUnit | null }
export type Overrides = Partial<Record<ModelId, ParamsOverride>>

// Всё, что человек меняет руками, — в одном снимке (перепись полей: mglass-screens, «Черновик»).
export type Snapshot = {
  kind: Kind
  thickness: number | null
  source: Source
  dxf: Dxf | null
  spec: PartSpec
  qty: number
  materialId: number | null
  temperWanted: boolean
  hasFacet: boolean
  facetMm: number                        // 0 — не выбран; действующая ширина — из справочника фацета
  discount: number
  model: ModelId
  overrides: Overrides
  wholeOrder: boolean
  items: CartItem[]
}

export const STORE_KEY = 'glasmen-demo:quote:v2'
export const QTY_MAX = 10000
export const DXF_STORE_LIMIT = 400_000          // символов: больший DXF не кладём в localStorage, только деталь в корзине

const UNIT_IDS: DxfUnit[] = ['mm', 'cm', 'm', 'inch', 'ft']

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)
const finite = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) ? x : d)

// Разбор DXF один раз на текст + единицы: загрузка, проверка для черновика и экран берут один результат.
// Исключение разбора — тоже результат (failed), а не падение экрана.
export type Parsed = { geom: PartGeometry | null; failed: string | null }
const parseCache: { text: string; name: string; units: DxfUnit | null; out: Parsed }[] = []
export function parseOnce(text: string, name: string, units: DxfUnit | null): Parsed {
  const hit = parseCache.find(c => c.units === units && c.name === name && c.text === text)
  if (hit) return hit.out
  let out: Parsed
  try {
    out = { geom: parseDxf(text, { name, ...(units ? { units } : {}) }), failed: null }
  } catch (e) {
    out = { geom: null, failed: e instanceof Error ? e.message : 'неизвестная ошибка' }
  }
  parseCache.unshift({ text, name, units, out })
  if (parseCache.length > 4) parseCache.pop()
  return out
}

// В черновик кладём только чертёж, который разобрался в пределах (без too_complex / bad_numbers):
// иначе тяжёлый файл разбирался бы при каждом открытии страницы и вешал её снова.
const POISON = new Set(['too_complex', 'bad_numbers'])
export const storable = (p: Parsed) => !!p.geom && !p.geom.issues.some(i => POISON.has(i.code))

// Галочку «лесенка и на закалку» снять нельзя (нет доли закалки в цене) — старое значение из черновика не шлём.
export function stripOverride(v: ParamsOverride | undefined): ParamsOverride | undefined {
  if (!v) return v
  const c = { ...v }
  delete c.ladderAppliesToTempering
  return c
}

function defaults(source: Source): Snapshot {
  return {
    kind: 'glass', thickness: null, source, dxf: null, spec: defaultSpec(), qty: 1,
    materialId: null, temperWanted: true, hasFacet: false, facetMm: 0,
    discount: 0, model: 'current', overrides: {}, wholeOrder: false, items: [],
  }
}

const num0 = (x: unknown, d: number) => finite(x, d)

function readHole(x: unknown): HoleGroup | null {
  if (!isObj(x)) return null
  const layout = HOLE_LAYOUTS.some(l => l.id === x.layout) ? (x.layout as HoleGroup['layout']) : DEFAULT_HOLE.layout
  return { d: num0(x.d, DEFAULT_HOLE.d), n: num0(x.n, DEFAULT_HOLE.n), layout, edge: num0(x.edge, DEFAULT_HOLE.edge), end: num0(x.end, DEFAULT_HOLE.end) }
}

function readCutout(x: unknown): CutoutGroup | null {
  if (!isObj(x)) return null
  return { w: num0(x.w, DEFAULT_CUTOUT.w), h: num0(x.h, DEFAULT_CUTOUT.h), r: num0(x.r, DEFAULT_CUTOUT.r), n: num0(x.n, DEFAULT_CUTOUT.n), fromTop: num0(x.fromTop, DEFAULT_CUTOUT.fromTop) }
}

function readSpec(x: unknown): PartSpec {
  const d = defaultSpec()
  if (!isObj(x)) return d
  const shape = SHAPES.some(sh => sh.id === x.shape) ? (x.shape as PartSpec['shape']) : d.shape
  const list = <T,>(v: unknown, read: (y: unknown) => T | null) => (Array.isArray(v) ? v.slice(0, 10).map(read).filter((y): y is T => y !== null) : [])
  return {
    shape, W: num0(x.W, d.W), H: num0(x.H, d.H), R: num0(x.R, d.R), A: num0(x.A, d.A), HL: num0(x.HL, d.HL), HR: num0(x.HR, d.HR),
    holes: list(x.holes, readHole), cutouts: list(x.cutouts, readCutout),
  }
}

function readCartItem(x: unknown): CartItem | null {
  if (!isObj(x)) return null
  const { id, name, materialId, materialLabel, width, height, shape, holes, cutouts, hasTempering, hasFacet, facetTypeMm, qty } = x
  if (typeof id !== 'string' || typeof name !== 'string' || typeof materialId !== 'number' || typeof materialLabel !== 'string') return null
  if (typeof width !== 'number' || typeof height !== 'number' || (shape !== 'rect' && shape !== 'curved')) return null
  if (!Array.isArray(holes) || !holes.every(h => isObj(h) && typeof h.d === 'number' && typeof h.n === 'number')) return null
  return {
    id, name, materialId, materialLabel, width, height, shape,
    holes: holes as CartItem['holes'], cutouts: finite(cutouts, 0),
    hasTempering: hasTempering === true, hasFacet: hasFacet === true,
    ...(typeof facetTypeMm === 'number' ? { facetTypeMm } : {}),
    qty: Math.max(1, Math.round(finite(qty, 1))),
  }
}

// Чтение снимка поле за полем: битое поле — значение по умолчанию, битая строка корзины отбрасывается одна.
// Сохранённый чертёж разбирается заново под try/catch; не разобрался в пределах — убираем его из черновика.
export function readSnapshot(initialSource: Source | null, stored: string | null): { snap: Snapshot; droppedDxf: string | null } {
  const d = defaults(initialSource ?? 'form')
  let raw: unknown = null
  try { raw = JSON.parse(stored ?? 'null') } catch { raw = null }
  if (!isObj(raw)) return { snap: d, droppedDxf: null }
  const source: Source = initialSource ?? (raw.source === 'dxf' || raw.source === 'form' ? raw.source : d.source)
  const rd = isObj(raw.dxf) ? raw.dxf : null
  let dxf: Dxf | null = rd && typeof rd.text === 'string' && typeof rd.name === 'string'
    ? { text: rd.text, name: rd.name, units: UNIT_IDS.includes(rd.units as DxfUnit) ? (rd.units as DxfUnit) : null }
    : null
  let droppedDxf: string | null = null
  if (dxf && !storable(parseOnce(dxf.text, dxf.name, null))) {
    droppedDxf = dxf.name
    dxf = null
  }
  const model = MODEL_IDS.includes(raw.model as ModelId) ? (raw.model as ModelId) : d.model
  const overrides: Overrides = {}
  if (isObj(raw.overrides)) for (const id of MODEL_IDS) if (isObj(raw.overrides[id])) overrides[id] = stripOverride(raw.overrides[id] as ParamsOverride)
  const items = Array.isArray(raw.items) ? raw.items.map(readCartItem).filter((x): x is CartItem => x !== null) : []
  const snap: Snapshot = {
    kind: raw.kind === 'mirror' ? 'mirror' : 'glass',
    thickness: typeof raw.thickness === 'number' && Number.isFinite(raw.thickness) ? raw.thickness : null,
    source, dxf, spec: readSpec(raw.spec),
    qty: Math.min(QTY_MAX, Math.max(1, Math.round(finite(raw.qty, 1)))),
    materialId: typeof raw.materialId === 'number' ? raw.materialId : null,
    temperWanted: raw.temperWanted !== false,
    hasFacet: raw.hasFacet === true,
    facetMm: finite(raw.facetMm, d.facetMm),
    discount: raw.discount === 10 ? 10 : 0,
    model, overrides, wholeOrder: raw.wholeOrder === true, items,
  }
  return { snap, droppedDxf }
}

// Что панель цены говорит вместо цены (blocked), над ценой (hardNote) и почему нельзя «Добавить в расчёт».
// Правила стекла — черновик: при жёстких замечаниях цена показывается для справки, а в расчёт не идёт.
export type GateInput = {
  matsDone: boolean
  hasMaterial: boolean
  source: Source
  hasDxf: boolean
  hasFacts: boolean               // есть геометрия с габаритом > 0
  unitsPending: boolean
  hardCount: number
}

export function priceGate(g: GateInput): { blocked: string | null; hardNote: string | null; addReason: string | null } {
  const blocked = !g.matsDone ? 'Загружаю материалы…'
    : !g.hasMaterial ? 'Нет материала — расчёт невозможен.'
    : g.source === 'dxf' && !g.hasDxf ? 'Загрузите чертёж DXF в шаге «Форма» — или выберите форму без чертежа.'
    : g.source === 'dxf' && !g.hasFacts ? 'Цены нет: в чертеже не найден контур детали — смотрите проверку под чертежом.'
    : !g.hasFacts ? 'Задайте размеры детали.'
    : g.unitsPending ? 'Подтвердите единицы, чтобы увидеть цену.'
    : null
  const n = g.hardCount
  const hardNote = n > 0
    ? `По черновым правилам стекла (ждут технолога) деталь не пройдёт: ${n} ${plural(n, 'замечание', 'замечания', 'замечаний')} в проверке под чертежом. Исправьте чертёж, размеры или откажитесь от закалки. Цена ниже — только для справки.`
    : null
  const addReason = blocked ?? (n > 0 ? 'по черновым правилам стекла деталь не пройдёт — исправьте замечания в проверке под чертежом.' : null)
  return { blocked, hardNote, addReason }
}

// Файл объявил не мм или не объявил единиц вовсе — цена только после подтверждения человеком.
export const unitsPendingFor = (dxf: Dxf | null, auto: PartGeometry | null | undefined) =>
  !!dxf && !dxf.units && !!auto && auto.units.detected !== 'mm'
