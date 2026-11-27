import { exVat, times, type Range } from '../classification/vat'
import type { Reader } from './reference'
import type { DirectLine } from './cost'
import { areaM2, type PartSpec, type Missing } from './technology'

// Прямые переменные нового изделия: стекло по закупке с расходом и сторонняя закалка.
// Расход сверла и абразива не добавляется: «производственные расходники» уже входят в ставки
// участков, и второй раз они стали бы двойным счётом.
export type ExtraDirect = { label: string; amountGross: number; vat: number | 'none' | 'unknown' }

const vatRange = (gross: number, vat: number | 'none' | 'unknown'): Range => {
  const r = vat === 'none' ? { kind: 'none' as const, status: 'owner' as const }
    : vat === 'unknown' ? { kind: 'unknown' as const } : { kind: 'rate' as const, rate: vat, status: 'owner' as const }
  return exVat(gross, r)
}

export function directForSpecs(specs: PartSpec[], ref: Reader, opts: { wholeSheets: boolean; extra: ExtraDirect[] }) {
  const lines: DirectLine[] = []
  const missing: Missing[] = []
  const miss = (op: Missing['op'], what: string, partKey: string | null = null) => missing.push({ partKey, op, what })
  const sheet = ref.need('sheet.areaM2').lo

  for (const p of specs) {
    const net = areaM2(p) * p.qty
    if (!net) continue
    const price = p.materialKey ? ref.get(`mat.${p.materialKey}.price`) : null
    const label = (p.materialKey ? ref.param(`mat.${p.materialKey}.price`)?.label : null) ?? 'материал не выбран'
    if (!price) miss('material', 'нет закупочной цены материала', p.key)
    else {
      const waste = ref.get(`mat.${p.materialKey}.waste`)
      if (!waste) miss('material', 'нет нормы расхода листа: взята чистая площадь', p.key)
      const w = waste ?? { lo: 0, hi: 0 }
      const use = { lo: net * (1 + w.lo / 100), hi: net * (1 + w.hi / 100) }
      const m2 = opts.wholeSheets ? { lo: Math.ceil(use.lo / sheet - 1e-9) * sheet, hi: Math.ceil(use.hi / sheet - 1e-9) * sheet } : use
      const layers = p.layers ?? 1
      const vat = ref.param(`mat.${p.materialKey}.price`)?.vat ?? 'unknown'
      lines.push({
        label: `Стекло: ${label}${layers > 1 ? ` × ${layers} слоя` : ''}`,
        cost: { lo: vatRange(price.lo * m2.lo * layers, vat).lo, hi: vatRange(price.hi * m2.hi * layers, vat).hi },
        note: `${Math.round(m2.hi * 1000) / 1000} м² × ${price.hi} ₽/м²${opts.wholeSheets ? ', целыми листами' : ', с расходом'}`,
      })
      if (layers > 1) miss('material', 'пакет: материал всех слоёв взят по первому; триплексование не учтено', p.key)
    }
    if (p.tempering) {
      const rate = p.thicknessMm == null ? null : ref.get(`temper.price.${p.thicknessMm}`)
      if (!rate) miss('tempering', `нет цены закалки для ${p.thicknessMm ?? '?'} мм`, p.key)
      else lines.push({ label: `Закалка ${p.thicknessMm} мм`, cost: times(rate, net * (p.layers ?? 1)), note: `${Math.round(net * 1000) / 1000} м², без НДС` })
    }
    if (p.packaging) miss('packaging', 'упаковочные материалы не учтены: норма расхода не задана', p.key)
  }
  for (const e of opts.extra) {
    if (e.amountGross > 0) lines.push({ label: e.label || 'Прочее прямое', cost: vatRange(e.amountGross, e.vat), note: 'введено вручную' })
  }
  return { lines, missing }
}

// То, чего модель не учитывает ни в одном расчёте, пока значения не появятся.
export const GENERAL_MISSING: Missing[] = [
  'амортизация оборудования: вместо неё в ставках платёж лизинга (денежная база)',
  'брак и переделки: нормы нет',
  'проценты, выкуп и капитальные вложения не выделены',
  'труд макета, приёмки с закалки и отгрузки: норм нет',
].map(what => ({ partKey: null, op: 'general' as const, what }))
