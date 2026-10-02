import { allocate, type FundItemInput, type MaterialKey } from '@/lib/pricing/orderFunds'

// Сохранённый расчёт розницы (calculations, product_type build | quick) → изделия для orderFunds.
// Только то, что лежит в строке: себестоимости, которой нет, не восстанавливаем (решение маршрута Э6).

export type RetailCalcRow = {
  product_type: string
  final_price: number | string | null
  input_data: unknown
  cost_breakdown: unknown
  financial_breakdown: unknown
}

export type RetailCalcItems = {
  items: FundItemInput[]
  partner: { pct: number | null } | null   // pct null — ставка известного партнёра из настроек CFO
  partnerSource: string | null
}

const obj = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v.replace(/[^\d.-]/g, '')) : NaN
  return Number.isFinite(n) ? n : null
}

const SOURCE_BUILD = '«Расчёт»: стекло — прайс B2B, фурнитура — комплект модели'
const SOURCE_QUICK = '«Быстрый»: вписано менеджером'
const SOURCE_QUICK_FORM = '«Быстрый»: вписано менеджером в форму перед сохранением'

// Душевая в «Расчёте» называется кодом модели («М4 Распашная · …»), зеркало — именем модели.
const isBuildShower = (title: string) => /^[МM]\d+\b/.test(title.trim())
const isQuickShower = (title: string) => /душев|перегород|шторк/i.test(title)

export function retailCalcItems(row: RetailCalcRow): RetailCalcItems {
  const input = obj(row.input_data), cb = obj(row.cost_breakdown), fb = obj(row.financial_breakdown)
  const cart = Array.isArray(input.cart) ? (input.cart as unknown[]).map(obj) : []
  const finalPrice = num(row.final_price) ?? 0
  const totals = cart.map(c => Math.max(0, num(c.total) ?? 0))
  // Скидки и надбавка дизайнера — на весь чек; чек делится по изделиям в доле их итога.
  const prices = allocate(Math.round(finalPrice), totals)

  if (row.product_type === 'build') {
    const perSection = num(input.perSection)
    const items = cart.map((c, i): FundItemInput => {
      const title = String(c.title ?? 'Изделие')
      const cost = num(c.cost)
      const glass = num(cb.glassCost), hw = num(cb.hwCost)
      const single = cart.length === 1
      let materials: { key: MaterialKey; amount: number | null }[] = []
      if (single && glass != null && hw != null && cost != null && Math.abs(glass + hw - cost) <= 1) {
        materials = [{ key: 'glass', amount: glass }, { key: 'hardware', amount: hw }]
      } else if (cost != null) {
        materials = [{ key: 'materials', amount: cost }]
      }
      const install = num(c.install)
      const bySections = single ? num(cb.sections) : null
      const byInstall = perSection && perSection > 0 && install != null && install > 0 && Number.isInteger(install / perSection) ? install / perSection : null
      const glassCount = bySections ?? byInstall
      return {
        label: title, kind: isBuildShower(title) ? 'shower' : 'other', price: prices[i],
        materials, materialsSource: materials.length ? SOURCE_BUILD : undefined,
        glassCount,
        glassCountSource: bySections != null ? 'полотен по модели' : byInstall != null ? 'по секциям монтажа' : undefined,
      }
    })
    // «Расчёт» (Ш1) помечает заказ через известного партнёра флагом; его долю берём из ставок CFO.
    const viaPartner = input.partner === true
    return { items, partner: viaPartner ? { pct: null } : null, partnerSource: viaPartner ? 'известный партнёр из «Расчёта»' : null }
  }

  const formDirect = num(cb.directCost) ?? 0
  const items = cart.map((c, i): FundItemInput => {
    const title = String(c.title ?? 'Изделие')
    const glass = num(c.glassCost), hw = num(c.hwCost)
    let materials: { key: MaterialKey; amount: number | null }[] = []
    let source: string | undefined
    if (glass != null && hw != null) {
      materials = [{ key: 'glass', amount: glass }, { key: 'hardware', amount: hw }]
      source = SOURCE_QUICK
    } else if (i === cart.length - 1 && formDirect > 0) {
      // directCost > 0 значит форма была заполнена, а заполненная форма — последнее изделие снимка.
      const fg = num(input.glass) ?? 0, fh = num(input.hw) ?? 0
      if (Math.abs(fg + fh - formDirect) <= 1) {
        materials = [{ key: 'glass', amount: fg }, { key: 'hardware', amount: fh }]
        source = SOURCE_QUICK_FORM
      }
    }
    const sections = num(c.sections)
    return {
      label: title, kind: isQuickShower(title) ? 'shower' : 'other', price: prices[i],
      materials, materialsSource: source,
      glassCount: sections != null && sections > 0 ? sections : null,
      glassCountSource: sections != null && sections > 0 ? 'по секциям монтажа' : undefined,
    }
  })
  const designer = num(input.designer)
  const markup = num(fb.designerMarkupPct)
  const pct = designer != null && designer > 0 ? designer : markup != null && markup > 5 ? markup - 5 : null
  return {
    items,
    partner: pct != null ? { pct } : null,
    partnerSource: pct != null ? `дизайнер ${pct}% из расчёта` : null,
  }
}
