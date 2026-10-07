// Себестоимость заказа — на статьи, для карточки сделки (/b2b-deal/[id]).
//
// Владелец 07.10 на №05655: «к оплате 11 427, себестоимость 6 439, но она не
// расписана — не понимаю, что учтено в этих деньгах». Два числа стояли рядом в
// разных базах: к оплате — с НДС, себестоимость — без. Поэтому разбивка идёт
// до конца: статьи с НДС → минус входной НДС → без НДС, и рядом продажа без НДС
// и прибыль — тогда маржа из шапки проверяется вычитанием.
//
// Статьи берутся из itemCostPanel — та же разбивка, что в строке калькулятора,
// чтобы два экрана не называли одно и то же по-разному.

import { itemCostPanel, type CostPanelItem } from './itemCostPanel'
import { VAT } from '@/lib/b2bCalculator'

export type OrderCostItem = CostPanelItem & {
  materialName?: unknown
  width?: unknown
  height?: unknown
  quantity?: unknown
  wastePercent?: unknown
  totalAreaNet?: unknown
  totalAreaBilled?: unknown
}

export type OrderCostLine = { name: string; total: number; note?: string }

export type OrderCostPosition = {
  index: number                 // номер позиции, с 1
  title: string                 // «444×2196 ×1»
  lines: OrderCostLine[]
  withVat: number
}

export type OrderCostBreakdown = {
  lines: OrderCostLine[]        // статьи с НДС, сложены по позициям; Σ = withVat
  withVat: number
  vat: number                   // входной НДС к вычету = withVat − exVat
  exVat: number                 // Σ себестоимости позиций без НДС
  stored: number                // себестоимость, сохранённая в заказе (total_cost_net)
  storedDiff: number            // stored − exVat; 0 — сходится
  saleExVat: number             // к оплате без НДС
  profit: number                // saleExVat − exVat
  positions: OrderCostPosition[]
}

const n = (x: unknown) => Number(x) || 0
const area = (v: number) => v.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function orderCostBreakdown(items: OrderCostItem[], total: number, storedCostNet: number): OrderCostBreakdown {
  const byName = new Map<string, number>()
  const add = (name: string, v: number) => { if (v) byName.set(name, (byName.get(name) ?? 0) + v) }
  const positions: OrderCostPosition[] = []
  let withVat = 0, exVat = 0
  let netArea = 0, billedArea = 0
  const wastes = new Set<number>()

  items.forEach((it, i) => {
    const stored = Math.round(n(it.costWithVat))
    withVat += stored
    exVat += Math.round(n(it.costExVat))
    const panel = itemCostPanel(it)
    const lines: OrderCostLine[] = []
    if (panel?.kind === 'product') {
      // Изделие (зеркало с подсветкой, лофт): его состав — в позиции; в сводке одной строкой.
      const name = `Изделие: ${String(it.materialName ?? '').trim() || 'без названия'}`
      add(name, stored)
      for (const l of panel.lines) lines.push({ name: l.name, total: Math.round(l.total) })
    } else if (panel) {
      for (const l of panel.lines) { add(l.name, Math.round(l.total)); lines.push({ name: l.name, total: Math.round(l.total) }) }
      netArea += n(it.totalAreaNet); billedArea += n(it.totalAreaBilled)
      if (n(it.costMaterial) > 0) wastes.add(n(it.wastePercent))
    }
    // Что строки не объяснили — отдельной строкой, а не молча: итог обязан сойтись.
    // У изделия в сводку уже ушла вся его себестоимость, поэтому разница — только в позиции.
    const gap = stored - lines.reduce((s, l) => s + l.total, 0)
    if (gap !== 0) {
      if (panel?.kind !== 'product') add('Не разложено по статьям', gap)
      lines.push({ name: 'Не разложено по статьям', total: gap })
    }
    positions.push({ index: i + 1, title: `${n(it.width)}×${n(it.height)} ×${n(it.quantity) || 1}`, lines, withVat: stored })
  })

  const lines: OrderCostLine[] = [...byName.entries()].map(([name, total]) => ({ name, total }))
  const mat = lines.find(l => l.name === 'Материал')
  if (mat && netArea > 0) {
    const w = wastes.size === 1 ? [...wastes][0] : null
    // Без знака «=»: 4,10 × 1,3 в показанной точности — 5,33, а сумма по позициям — 5,32.
    mat.note = `в расчёте ${area(billedArea)} м² при чистых ${area(netArea)} м² — отход${w != null ? ` ${w}%` : ''} на раскрой`
  }

  const saleExVat = Math.round(total * 100 / (100 + VAT))
  const stored = Math.round(storedCostNet)
  return {
    lines, withVat, vat: withVat - exVat, exVat,
    stored, storedDiff: stored - exVat,
    saleExVat, profit: saleExVat - exVat,
    positions,
  }
}
