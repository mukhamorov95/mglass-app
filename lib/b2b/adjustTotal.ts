// Пересчёт позиций заказа под новую итоговую сумму — в любую сторону.
// Владелец меняет итог уже запущенного заказа: скидка при торге либо, наоборот,
// доп.работы и пересогласование вверх. Цены позиций масштабируются пропорционально,
// НДС и маржа считаются заново от НЕИЗМЕННОЙ себестоимости.
//
// Дрейф округления поглощает последняя позиция: сумма позиций обязана совпасть с
// новым итогом до рубля, иначе КП и счёт разойдутся с заказом.

const VAT = 22 // как в lib/b2bCalculator

export type AdjustItem = Record<string, unknown> & {
  saleIncVat?: unknown
  costExVat?: unknown
}

export function rescaleItemsToTotal(items: AdjustItem[], oldTotal: number, newTotal: number): AdjustItem[] {
  const factor = newTotal / oldTotal
  let running = 0
  return items.map((it, idx) => {
    const oldInc = Math.round(Number(it.saleIncVat) || 0)
    const last = idx === items.length - 1
    const newInc = last ? newTotal - running : Math.round(oldInc * factor)
    if (!last) running += newInc
    const saleExVat = Math.round(newInc * 100 / (100 + VAT))
    const outputVat = newInc - saleExVat
    const costExVat = Number(it.costExVat) || 0
    const margin = saleExVat > 0 ? Math.round((1 - costExVat / saleExVat) * 100) : 0
    return { ...it, saleIncVat: newInc, saleExVat, outputVat, manualTotal: newInc, margin }
  })
}
