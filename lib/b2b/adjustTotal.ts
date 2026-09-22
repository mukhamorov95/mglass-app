// Пересчёт позиций заказа под новую итоговую сумму — в любую сторону.
// Владелец меняет итог уже запущенного заказа: скидка при торге либо, наоборот,
// доп.работы и пересогласование вверх. Цены позиций масштабируются пропорционально,
// НДС и маржа считаются заново от НЕИЗМЕННОЙ себестоимости.
//
// Дрейф округления поглощает последняя позиция: сумма позиций обязана совпасть с
// новым итогом до рубля, иначе КП и счёт разойдутся с заказом.
//
// ВАЖНО про базу масштабирования. Старый итог заказа — это сумма ДЕЙСТВУЮЩИХ цен
// позиций: у позиции со скидкой это прайс минус скидка, у договорной — сама
// договорная цена. Раньше коэффициент считался от этого итога, а умножался на
// прайсовую saleIncVat — то есть на другую величину. При любой скидке или
// договорной цене позиции разъезжались, а последняя, забиравшая остаток, уходила
// в ноль и в минус: в проде так получились заказы 05024 (−1 755 ₽),
// 05097 (−11 068 ₽) и 05338 (−62 121 ₽). Масштабируем ровно то, из чего сложен
// старый итог.

const VAT = 22 // как в lib/b2bCalculator

export type AdjustItem = Record<string, unknown> & {
  saleIncVat?: unknown
  costExVat?: unknown
  manualTotal?: unknown
  clientPriced?: unknown
}

const num = (v: unknown) => Number(v) || 0

// Действующая цена позиции — та же логика, что в effectiveItemTotal
// (lib/b2bCalculator.ts): договорная цена конечна, скидка не применяется к
// индивидуальному прайсу клиента.
export function currentItemTotal(it: AdjustItem, discountPercent: number): number {
  if (it.manualTotal != null && it.manualTotal !== '') return Math.round(num(it.manualTotal))
  const pct = it.clientPriced ? 0 : discountPercent
  return Math.round(num(it.saleIncVat) * (1 - pct / 100))
}

export function rescaleItemsToTotal(
  items: AdjustItem[],
  oldTotal: number,
  newTotal: number,
  discountPercent = 0,
): AdjustItem[] {
  const base = items.map(it => currentItemTotal(it, discountPercent))
  const baseSum = base.reduce((s, v) => s + v, 0)
  // Если старый итог не сходится с суммой действующих цен (данные из старых
  // просчётов), опираемся на сумму позиций: масштабировать можно только то,
  // что реально сложено из них.
  const from = baseSum > 0 ? baseSum : oldTotal
  const factor = from > 0 ? newTotal / from : 0

  let running = 0
  return items.map((it, idx) => {
    const last = idx === items.length - 1
    const newInc = last ? newTotal - running : Math.round(base[idx] * factor)
    if (!last) running += newInc
    const saleExVat = Math.round(newInc * 100 / (100 + VAT))
    const outputVat = newInc - saleExVat
    const costExVat = num(it.costExVat)
    const margin = saleExVat > 0 ? Math.round((1 - costExVat / saleExVat) * 100) : 0
    return { ...it, saleIncVat: newInc, saleExVat, outputVat, manualTotal: newInc, margin }
  })
}
