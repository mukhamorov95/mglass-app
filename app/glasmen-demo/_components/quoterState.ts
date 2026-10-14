// Состояние экрана расчёта без React: черновик в localStorage, разбор DXF один раз на текст,
// решение «показывать ли цену». Отдельно от Quoter.tsx, чтобы проверяться тестами в node.
import { defaultParams, getTemplate, parseDxf, type DxfUnit, type PartGeometry, type TemplateId, type TemplateParams } from '@/lib/glasmen'
import type { ModelId, ParamsOverride } from './api'
import { MODEL_IDS, plural } from './api'
import type { CartItem } from './MiniCart'

export type Tab = 'dxf' | 'template' | 'size'
export type Dxf = { text: string; name: string; units: DxfUnit | null }
export type Overrides = Partial<Record<ModelId, ParamsOverride>>

// Всё, что человек меняет руками, — в одном снимке (перепись полей: mglass-screens, «Черновик»).
export type Snapshot = {
  tab: Tab
  dxf: Dxf | null
  templateId: TemplateId
  templateParams: TemplateParams
  size: { W: number; H: number }
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

export const STORE_KEY = 'glasmen-demo:quote:v1'
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

function defaults(tab: Tab): Snapshot {
  const t = getTemplate('rect')!
  return {
    tab, dxf: null, templateId: 'rect', templateParams: defaultParams(t), size: { W: 1000, H: 600 },
    materialId: null, temperWanted: true, hasFacet: false, facetMm: 0,
    discount: 0, model: 'current', overrides: {}, wholeOrder: false, items: [],
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
export function readSnapshot(initialTab: Tab | null, stored: string | null): { snap: Snapshot; droppedDxf: string | null } {
  const d = defaults(initialTab ?? 'dxf')
  let raw: unknown = null
  try { raw = JSON.parse(stored ?? 'null') } catch { raw = null }
  if (!isObj(raw)) return { snap: d, droppedDxf: null }
  const tab = initialTab ?? (raw.tab === 'dxf' || raw.tab === 'template' || raw.tab === 'size' ? raw.tab : d.tab)
  const rd = isObj(raw.dxf) ? raw.dxf : null
  let dxf: Dxf | null = rd && typeof rd.text === 'string' && typeof rd.name === 'string'
    ? { text: rd.text, name: rd.name, units: UNIT_IDS.includes(rd.units as DxfUnit) ? (rd.units as DxfUnit) : null }
    : null
  let droppedDxf: string | null = null
  if (dxf && !storable(parseOnce(dxf.text, dxf.name, null))) {
    droppedDxf = dxf.name
    dxf = null
  }
  const tpl = typeof raw.templateId === 'string' ? getTemplate(raw.templateId) : undefined
  const tplParams: TemplateParams = tpl ? defaultParams(tpl) : d.templateParams
  if (tpl && isObj(raw.templateParams)) for (const p of tpl.params) tplParams[p.key] = finite(raw.templateParams[p.key], tplParams[p.key])
  const size = isObj(raw.size) ? { W: finite(raw.size.W, d.size.W), H: finite(raw.size.H, d.size.H) } : d.size
  const model = MODEL_IDS.includes(raw.model as ModelId) ? (raw.model as ModelId) : d.model
  const overrides: Overrides = {}
  if (isObj(raw.overrides)) for (const id of MODEL_IDS) if (isObj(raw.overrides[id])) overrides[id] = stripOverride(raw.overrides[id] as ParamsOverride)
  const items = Array.isArray(raw.items) ? raw.items.map(readCartItem).filter((x): x is CartItem => x !== null) : []
  const snap: Snapshot = {
    tab, dxf, templateId: tpl ? tpl.id : d.templateId, templateParams: tplParams, size,
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
  tab: Tab
  hasDxf: boolean
  hasFacts: boolean               // есть геометрия с габаритом > 0
  unitsPending: boolean
  hardCount: number
}

export function priceGate(g: GateInput): { blocked: string | null; hardNote: string | null; addReason: string | null } {
  const blocked = !g.matsDone ? 'Загружаю материалы…'
    : !g.hasMaterial ? 'Нет материала — расчёт невозможен.'
    : g.tab === 'dxf' && g.hasDxf && !g.hasFacts ? 'Цены нет: в чертеже не найден контур детали — смотрите проверку слева.'
    : !g.hasFacts ? 'Загрузите чертёж, выберите шаблон или задайте размеры.'
    : g.unitsPending ? 'Подтвердите единицы, чтобы увидеть цену.'
    : null
  const n = g.hardCount
  const hardNote = n > 0
    ? `По черновым правилам стекла (ждут технолога) деталь не пройдёт: ${n} ${plural(n, 'замечание', 'замечания', 'замечаний')} в проверке слева. Исправьте чертёж, размеры или откажитесь от закалки. Цена ниже — только для справки.`
    : null
  const addReason = blocked ?? (n > 0 ? 'по черновым правилам стекла деталь не пройдёт — исправьте замечания в проверке слева.' : null)
  return { blocked, hardNote, addReason }
}

// Файл объявил не мм или не объявил единиц вовсе — цена только после подтверждения человеком.
export const unitsPendingFor = (dxf: Dxf | null, auto: PartGeometry | null | undefined) =>
  !!dxf && !dxf.units && !!auto && auto.units.detected !== 'mm'
