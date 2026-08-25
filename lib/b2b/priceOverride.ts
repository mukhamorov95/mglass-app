import { VAT, effectiveItemTotal, type B2BOrderItem } from '../b2bCalculator'

// Ручная корректировка ИТОГА просчёта: менеджер вписывает конечную сумму клиенту,
// система раскладывает её по позициям пропорционально прайсу и фиксирует скидку.
//
// Принципы (нарушать нельзя — на них держится паритет КП/счёта/производства):
//   • Прайсовая база позиции (saleIncVat) НЕ перезаписывается — корректировка живёт
//     наложением manualTotal (manualAuto=true). Поэтому она обратима и повторное
//     редактирование не копится (каждый раз считаем от прайса заново).
//   • Позиции с ручной ценой, выставленной руками в калькуляторе (manualAuto≠true),
//     считаются договорными: они не пересчитываются, а вычитаются из цели.
//   • Σ manualTotal == целевой сумме до рубля (остаток округления раздаётся по методу
//     наибольших остатков) — счёт и КП сходятся копейка-в-копейку.

export type OverrideMeta = {
  target: number
  base: number
  factor: number
  discount_percent: number
  at: string
  by?: string | null
  by_name?: string | null
}

export type DistributeResult =
  | { ok: true
      items: B2BOrderItem[]
      appliedTotal: number
      base: number
      fixedSum: number
      discountPercent: number
      markupPercent: number
      factor: number }
  | { ok: false; error: string }

const r2 = (n: number) => Math.round(n * 100) / 100

// Снять авто-корректировку — позиции возвращаются к прайсу. Ручные договорные
// цены (manualAuto≠true) остаются нетронутыми.
export function clearAutoOverride(items: B2BOrderItem[]): B2BOrderItem[] {
  return items.map(it => it.manualAuto ? { ...it, manualTotal: null, manualAuto: false } : it)
}

// Принимает и «лёгкий» тип позиции из списков просчётов — нужен только флаг.
export function hasAutoOverride(items: { manualAuto?: boolean }[] | null | undefined): boolean {
  return Array.isArray(items) && items.some(it => it?.manualAuto === true)
}

// Итог строки просчёта/заказа для любых экранов: договорная сумма, иначе прайс со скидкой.
export function finalTotalOf(row: {
  total_after_discount?: number | null
  total_sale_inc_vat?: number | null
}): number {
  return Number(row.total_after_discount) || Number(row.total_sale_inc_vat) || 0
}

export function distributeTargetTotal(rawItems: B2BOrderItem[], target: number): DistributeResult {
  if (!Array.isArray(rawItems) || rawItems.length === 0) return { ok: false, error: 'В просчёте нет позиций' }
  const t = Math.round(Number(target))
  if (!Number.isFinite(t) || t <= 0) return { ok: false, error: 'Некорректная сумма' }

  // Всегда считаем от прайса: повторная корректировка не наслаивается на предыдущую.
  const items = clearAutoOverride(rawItems)

  const poolIdx: number[] = []
  let fixedSum = 0
  items.forEach((it, i) => {
    if (it.manualTotal != null) fixedSum += Math.round(Number(it.manualTotal) || 0)
    else poolIdx.push(i)
  })

  if (poolIdx.length === 0) {
    return { ok: false, error: 'Во всех позициях стоит ручная цена — правьте суммы внутри просчёта' }
  }

  const base = poolIdx.reduce((s, i) => s + Math.round(Number(items[i].saleIncVat) || 0), 0)
  if (base <= 0) return { ok: false, error: 'У позиций нет прайсовой цены' }

  const poolTarget = t - fixedSum
  if (poolTarget < poolIdx.length) {
    return {
      ok: false,
      error: fixedSum > 0
        ? `Договорные позиции уже дают ${fixedSum.toLocaleString('ru-RU')} ₽ — итог не может быть меньше`
        : 'Сумма слишком мала',
    }
  }

  const factor = poolTarget / base
  // Наибольшие остатки: floor по всем, затем +1 ₽ тем, у кого дробная часть больше.
  const parts = poolIdx.map(i => {
    const raw = (Math.round(Number(items[i].saleIncVat) || 0)) * factor
    const floor = Math.max(1, Math.floor(raw))
    return { i, floor, frac: raw - Math.floor(raw) }
  })
  let rest = poolTarget - parts.reduce((s, p) => s + p.floor, 0)
  const order = [...parts].sort((a, b) => b.frac - a.frac || a.i - b.i)
  for (let k = 0; rest > 0 && k < order.length; k++, rest--) order[k].floor += 1
  // Если после clamp'а на минимум 1 ₽ сумма перебрала — снимаем излишек с самых крупных.
  if (rest < 0) {
    const desc = [...parts].sort((a, b) => b.floor - a.floor)
    for (let k = 0; rest < 0 && k < desc.length; k = (k + 1) % desc.length) {
      if (desc[k].floor > 1) { desc[k].floor -= 1; rest++ }
      else if (desc.every(p => p.floor <= 1)) break
    }
  }

  const out = [...items]
  for (const p of parts) out[p.i] = { ...out[p.i], manualTotal: p.floor, manualAuto: true }

  const appliedTotal = out.reduce((s, it) => s + effectiveItemTotal(it, 0), 0)

  return {
    ok: true,
    items: out,
    appliedTotal,
    base,
    fixedSum,
    discountPercent: poolTarget < base ? r2((1 - factor) * 100) : 0,
    markupPercent:   poolTarget > base ? r2((factor - 1) * 100) : 0,
    factor: Math.round(factor * 1e6) / 1e6,
  }
}

// Маржа заказа — та же формула, что при сохранении из калькулятора: взвешенная
// по выручке без НДС после скидки/договорных цен.
export function orderMarginPercent(items: B2BOrderItem[], discountPercent: number): number {
  const revExVatAfter = items.reduce((s, i) => s + effectiveItemTotal(i, discountPercent) * 100 / (100 + VAT), 0)
  const costExVatSum  = items.reduce((s, i) => s + (Number(i.costExVat) || 0), 0)
  return revExVatAfter > 0 ? Math.round((1 - costExVatSum / revExVatAfter) * 100) : 0
}
