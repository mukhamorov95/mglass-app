// Прилавок партнёра на стройрынке (решение 01.10.2026, docs/partner-points/PARTNER_POINTS_ROUTE.md).
// Цену партнёра считает сервер (/api/partner/quote, единый движок). Здесь — только
// его розница: наценка точки поверх его же закупки. Себестоимости M-Glass тут нет
// и быть не может — на вход приходит итог позиции, который партнёр и так видит.

// Рекомендация 01.10 (второй мозг, решение о точках): цена покупателю = наш прайс × 1,25.
// Наценка точки — на её закупку, а закупка уже со скидкой партнёра, поэтому
// умолчание считается от скидки: при 10 % это 39 %, без скидки — 25 %.
export const RECOMMENDED_LIST_FACTOR = 1.25
export const MAX_MARKUP_PCT = 300
// Розница округляется вверх до 10 ₽ построчно: точка не теряет на копейках, а итог
// КП — ровно сумма напечатанных строк.
export const RETAIL_ROUND_RUB = 10
export const COUNTER_DRAFT_KEY = 'pcab-counter-draft-v1'
const MAX_DRAFT_ITEMS = 50

export const SUPER_CATS = [
  { value: 'стекло', label: 'Стекло', cats: ['стекло', 'тонированное', 'сатин', 'рифленое', 'декоративное'] },
  { value: 'зеркало', label: 'Зеркало', cats: ['зеркало'] },
] as const
export type SuperCat = typeof SUPER_CATS[number]['value']

export type CounterSpec = {
  materialId: number; width: number; height: number; quantity: number
  hasTempering: boolean; hasFacet: boolean; facetTypeMm: number | null; hasHoles: boolean
  shape: 'rect' | 'curved'; hasTriplex: boolean; triplexLayers: number
  triplexMat2Id: number | null; triplexMat3Id: number | null; applyMinPrice: boolean
}

export type PartnerSettings = { markupPct: number; kpName: string; kpPhone: string; kpNote: string }

export function normalizeMarkup(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v)
  if (v === null || v === '' || !Number.isFinite(n) || n < 0 || n > MAX_MARKUP_PCT) return null
  return Math.round(n * 100) / 100
}

export function recommendedMarkup(discountPct: number): number {
  const d = Number.isFinite(discountPct) && discountPct > 0 && discountPct < 100 ? discountPct : 0
  return Math.round((RECOMMENDED_LIST_FACTOR / (1 - d / 100) - 1) * 100)
}

export function retailLine(partnerLine: number, markupPct: number): number {
  if (!(partnerLine > 0)) return 0
  const raw = Math.round(partnerLine * (1 + markupPct / 100) * 100) / 100
  return Math.ceil(raw / RETAIL_ROUND_RUB) * RETAIL_ROUND_RUB
}

export function retailQuote(partnerLines: number[], markupPct: number): { lines: number[]; total: number } {
  const lines = partnerLines.map(l => retailLine(l, markupPct))
  return { lines, total: lines.reduce((s, l) => s + l, 0) }
}

const clip = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')

export function normalizeSettingsInput(body: Record<string, unknown>):
  { ok: true; value: PartnerSettings } | { ok: false; error: string } {
  const markupPct = normalizeMarkup(body.markupPct)
  if (markupPct == null) return { ok: false, error: `Наценка — число от 0 до ${MAX_MARKUP_PCT}%` }
  return {
    ok: true,
    value: { markupPct, kpName: clip(body.kpName, 120), kpPhone: clip(body.kpPhone, 40), kpNote: clip(body.kpNote, 500) },
  }
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const idOrNull = (v: unknown): number | null => { const n = num(v); return n != null && n > 0 ? n : null }

// Черновик прилавка живёт в браузере точки и переживает перезагрузку. Всё, что не
// похоже на позицию, отбрасываем: файл мог прийти от старой версии страницы.
export function parseDraft(raw: string | null): CounterSpec[] {
  if (!raw) return []
  let data: unknown
  try { data = JSON.parse(raw) } catch { return [] }
  if (!Array.isArray(data)) return []
  const out: CounterSpec[] = []
  for (const d of data.slice(0, MAX_DRAFT_ITEMS)) {
    if (!d || typeof d !== 'object') continue
    const s = d as Record<string, unknown>
    const materialId = idOrNull(s.materialId), width = num(s.width), height = num(s.height), quantity = num(s.quantity)
    if (materialId == null || !(width! > 0) || !(height! > 0) || !(quantity! > 0)) continue
    out.push({
      materialId, width: width!, height: height!, quantity: Math.round(quantity!),
      hasTempering: s.hasTempering === true, hasFacet: s.hasFacet === true,
      facetTypeMm: s.hasFacet === true ? num(s.facetTypeMm) : null,
      hasHoles: s.hasHoles === true, shape: s.shape === 'curved' ? 'curved' : 'rect',
      hasTriplex: s.hasTriplex === true, triplexLayers: s.triplexLayers === 3 ? 3 : 2,
      triplexMat2Id: idOrNull(s.triplexMat2Id), triplexMat3Id: idOrNull(s.triplexMat3Id),
      applyMinPrice: s.applyMinPrice !== false,
    })
  }
  return out
}

export function readDraft(): CounterSpec[] {
  try { return parseDraft(window.localStorage.getItem(COUNTER_DRAFT_KEY)) } catch { return [] }
}

export function writeDraft(list: CounterSpec[]): void {
  try {
    if (list.length === 0) window.localStorage.removeItem(COUNTER_DRAFT_KEY)
    else window.localStorage.setItem(COUNTER_DRAFT_KEY, JSON.stringify(list))
  } catch { /* приватный режим — черновик живёт до закрытия вкладки */ }
}

export function describeSpec(s: CounterSpec): string {
  return [s.hasTempering && 'закалка', s.hasFacet && `фацет${s.facetTypeMm ? ` ${s.facetTypeMm} мм` : ''}`,
    s.hasHoles && 'сверловка', s.shape === 'curved' && 'криволинейный рез', s.hasTriplex && 'триплекс']
    .filter(Boolean).join(', ')
}
