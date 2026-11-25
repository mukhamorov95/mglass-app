import { calcFrameCost, FRAME_COLORS, type MirrorFrame, type B2BService } from '@/lib/types'

// Обрамление зеркала профилем Ветро/АВ24 (В5, владелец 25.11.2026). Рамка — строка
// «Рамок зеркал»; если она привязана к прайсу поставщика, метр стоит по прайсу сегодня.
// Расход: периметр × запас на запил, покупаем целыми хлыстами. Продажа: цена метра из
// справочника × расход + сборка; продажная не задана — себестоимость / (1 − маржа − налог).

export type SupplierRow = { id: number; supplier: string; article: string | null; name: string; color: string | null; unit: string | null; cost_price: number | null; retail_price?: number | null }

// Длина хлыста из названия прайса: «длина 3 м», «3 метра», «…х6000».
export function parseWhipLength(name: string): number | null {
  const m = name.match(/длин[аыо]?\s*(\d+(?:[.,]\d+)?)\s*(?:метр|м(?![а-яё]))/i) ?? name.match(/(\d+(?:[.,]\d+)?)\s*метр/i)
  if (m) return Number(m[1].replace(',', '.')) || null
  const mm = name.match(/[хx×]\s*(\d{4})\b/i)
  return mm ? Number(mm[1]) / 1000 : null
}

// Себестоимость метра: прайс за хлыст (шт) делим на длину хлыста, за метр — как есть.
export function supplierCostPerM(row: SupplierRow, whipLenM: number): number | null {
  const c = Number(row.cost_price) || 0
  if (!(c > 0)) return null
  const unit = (row.unit ?? '').toLowerCase()
  if (/^м|пог/.test(unit)) return c
  return whipLenM > 0 ? c / whipLenM : null
}

export function guessFrameColor(text: string): string {
  const t = text.toLowerCase()
  if (/ч[её]рн/.test(t)) return 'black'
  if (/бел/.test(t)) return 'white'
  if (/браш/.test(t)) return 'brush'
  if (/золот|латун/.test(t)) return 'gold'
  if (/графит|оружейн|антрацит/.test(t)) return 'graphite'
  if (/хром|полир|зеркальн/.test(t)) return 'chrome'
  return 'custom'
}

export function effectiveFrame(frame: MirrorFrame & { supplier_row_id?: number | null }, rows: SupplierRow[]): { frame: MirrorFrame; costFrom: 'supplier' | 'directory' } {
  const row = frame.supplier_row_id ? rows.find(r => r.id === frame.supplier_row_id) : undefined
  const perM = row ? supplierCostPerM(row, Number(frame.whip_length_m) || 0) : null
  return perM ? { frame: { ...frame, cost_per_m: perM }, costFrom: 'supplier' } : { frame, costFrom: 'directory' }
}

export type FrameLine = {
  service: B2BService | null
  whips: number
  neededM: number
  cost: number
  sale: number
  saleFrom: 'directory' | 'formula'
  costFrom: 'supplier' | 'directory'
  problem: string | null
}

export function decorFrameLine(
  frame: MirrorFrame & { supplier_row_id?: number | null },
  rows: SupplierRow[],
  widthMm: number, heightMm: number,
  cfg: { marginPct: number; taxPct: number; costMinuteRate?: number; saleMinuteRate?: number },
): FrameLine {
  const { frame: f, costFrom } = effectiveFrame(frame, rows)
  const base = { whips: 0, neededM: 0, cost: 0, sale: 0, saleFrom: 'directory' as const, costFrom }
  if (!(Number(f.whip_length_m) > 0)) return { ...base, service: null, problem: `Обрамление «${f.name}»: не задана длина хлыста` }
  if (!(Number(f.cost_per_m) > 0)) return { ...base, service: null, problem: `Обрамление «${f.name}»: нет себестоимости метра` }
  const r = calcFrameCost(f, widthMm, heightMm, cfg.costMinuteRate, cfg.saleMinuteRate)
  const k = 1 - (cfg.marginPct + cfg.taxPct) / 100
  const fromDir = Number(f.sale_per_m) > 0
  const sale = fromDir ? r.totalSale : (k > 0 ? Math.round(r.totalCost / k) : 0)
  const cl = FRAME_COLORS.find(c => c.value === f.color)
  const colorLabel = cl && cl.value !== 'custom' ? ` ${cl.label.toLowerCase()}` : ''
  const service: B2BService = {
    id: -700_000 - f.id,   // синтетический: не галочка услуги (надбавки ≤ −1 000 000)
    name: `Обрамление ${f.article ?? f.name}${colorLabel} · ${Math.round(r.profileNeededM * 100) / 100} м`,
    type: 'fixed', value: sale, cost_price: r.totalCost,
    description: '', active: true, sort_order: 0,
  }
  return { service, whips: r.whipsNeeded, neededM: r.profileNeededM, cost: r.totalCost, sale, saleFrom: fromDir ? 'directory' : 'formula', costFrom, problem: null }
}
