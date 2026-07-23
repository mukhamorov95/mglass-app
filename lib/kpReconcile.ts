// Примирение сумм КП после AI-разбора речи. Менеджер часто называет общий итог,
// а строку услуги (доставка/подъём/монтаж) — без своей цены. AI справедливо не
// выдумывает число и оставляет sum пустой, но итог всё равно попадает в total.
// Здесь ЕДИНСТВЕННУЮ пустую строку доливаем разницей «итого − остальные строки».
// Ничего не выдумываем — сумма уже названа менеджером в итоге.

export const kpNum = (v: unknown): number => {
  if (v == null || v === '') return NaN
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^\d.-]/g, ''))
  return isFinite(n) ? n : NaN
}

export function reconcileKp(kp: Record<string, unknown>): Record<string, unknown> {
  const items = Array.isArray(kp.items) ? (kp.items as Record<string, unknown>[]) : []
  if (!items.length) return kp
  const sums = items.map(it => kpNum(it.sum))
  const filled = sums.reduce((s, v) => s + (isFinite(v) ? v : 0), 0)
  const empties = sums.map((v, i) => (!isFinite(v) || v === 0) ? i : -1).filter(i => i >= 0)
  const total = kpNum(kp.total)

  if (empties.length === 1 && isFinite(total) && total - filled > 0) {
    const gap = Math.round(total - filled)
    const it = items[empties[0]]
    it.sum = gap
    if (kpNum(it.price) === 0 || it.price == null || it.price === '') {
      const qty = kpNum(it.qty)
      it.price = (!isFinite(qty) || qty <= 1) ? gap : Math.round(gap / qty)
    }
  }

  const finalSum = items.reduce((s, it) => s + (isFinite(kpNum(it.sum)) ? kpNum(it.sum) : 0), 0)
  if (!isFinite(kpNum(kp.subtotal)) || kpNum(kp.subtotal) === 0) kp.subtotal = finalSum
  if (!isFinite(total) || total === 0) kp.total = finalSum
  kp.items = items
  return kp
}
