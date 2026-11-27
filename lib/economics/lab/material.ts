import { exVat, point, times, type Range } from '../classification/vat'
import type { Reader } from '../engine/reference'
import type { DirectLine } from '../engine/cost'
import type { Missing } from '../engine/technology'
import { areaM2, layersOf, weightKg, type LabPosition } from './project'

// Материал и сторонние услуги позиции. Три режима расхода (§5 ТЗ): коэффициент использования,
// целые листы по подтверждённому размещению, ручной расход. Коэффициент использования — доля
// годной площади в израсходованной, а не надбавка на отход: 0,75 ≠ +25 %.
export type MaterialUse = {
  positionId: string
  netM2: number            // площадь годных изделий, все слои
  usedM2: Range | null     // израсходовано
  sheets: Range | null
  weightKg: number
  mode: string
  note: string
}

const vatRange = (gross: number, vat: number | 'none' | 'unknown'): Range =>
  vat === 'none' ? point(gross)
    : vat === 'unknown' ? exVat(gross, { kind: 'unknown' })
    : exVat(gross, { kind: 'rate', rate: vat, status: 'owner' })

export function labDirect(positions: LabPosition[], ref: Reader, opts: { deductInputVat: boolean }) {
  const lines: DirectLine[] = []
  const missing: Missing[] = []
  const uses: MaterialUse[] = []
  const miss = (op: Missing['op'], what: string, partKey: string | null = null) =>
    missing.some(m => m.op === op && m.what === what && m.partKey === partKey) || missing.push({ partKey, op, what })

  const sheetArea = ref.get('sheet.areaM2')
  const kgPerMm = ref.get('glass.kgPerM2PerMm')?.lo ?? 0
  if (!kgPerMm) miss('material', 'нет веса квадратного метра: вес партии не посчитан')

  for (const p of positions) {
    const layers = layersOf(p)
    const net = areaM2(p) * p.qty * layers
    const key = p.materialId == null ? null : String(p.materialId)
    const priceParam = key ? ref.param(`mat.${key}.price`) : null
    const price = key ? ref.get(`mat.${key}.price`) : null

    let used: Range | null = null, sheets: Range | null = null, mode = '', note = ''
    if (p.material.kind === 'manual') {
      if (p.material.m2 == null) miss('material', 'ручной расход материала не введён', p.id)
      else { used = point(p.material.m2); mode = 'ручной расход'; note = `${p.material.m2} м² введено вручную` }
    } else if (p.material.kind === 'sheets') {
      const per = p.material.partsPerSheet
      if (!sheetArea) miss('material', 'нет площади листа', p.id)
      else if (!per) {
        miss('material', 'целые листы: не задано, сколько деталей размещается на листе — количество листов не считается делением площади', p.id)
      } else {
        const n = Math.ceil(p.qty * layers / per)
        sheets = point(n); used = point(n * sheetArea.lo)
        mode = 'целые листы'
        note = `${p.qty * layers} дет. ÷ ${per} на лист → ${n} листов × ${sheetArea.lo} м²`
        miss('material', 'целые листы: технологические припуски и пригодные остатки не учтены', p.id)
      }
    } else {
      const k = p.material.coefficient
      if (k && k > 0) { used = point(net / k); mode = 'коэффициент использования'; note = `${round(net)} м² ÷ ${k}` }
      else {
        const waste = key ? ref.get(`mat.${key}.waste`) : null
        if (!waste) miss('material', 'нет ни коэффициента использования, ни нормы отхода: расход не посчитан', p.id)
        else {
          used = { lo: net * (1 + waste.lo / 100), hi: net * (1 + waste.hi / 100) }
          mode = 'надбавка на отход из справочника'
          note = `${round(net)} м² + ${waste.lo === waste.hi ? waste.lo : `${waste.lo}…${waste.hi}`} % — это надбавка на отход, а не коэффициент использования`
          miss('material', 'коэффициент использования материала не задан: взята надбавка на отход из справочника', p.id)
        }
      }
    }
    if (used && sheetArea && !sheets) sheets = { lo: used.lo / sheetArea.lo, hi: used.hi / sheetArea.lo }

    uses.push({ positionId: p.id, netM2: net, usedM2: used, sheets, weightKg: weightKg(p, kgPerMm), mode, note })

    if (!price) miss('material', 'нет закупочной цены материала', p.id)
    else if (used) {
      const vat = opts.deductInputVat ? (priceParam?.vat ?? 'unknown') : 'none'
      lines.push({
        label: `Материал: ${p.materialLabel ?? priceParam?.label ?? `id ${key}`}${layers > 1 ? `, ${layers} слоя` : ''}`,
        cost: { lo: vatRange(price.lo * used.lo, vat).lo, hi: vatRange(price.hi * used.hi, vat).hi },
        note: `${round(used.hi)} м² × ${price.hi} ₽/м² (${mode})${opts.deductInputVat ? '' : ', НДС не возмещается'}`,
      })
      if (layers > 1) miss('material', 'пакет: все слои посчитаны по цене первого стекла', p.id)
    }

    if (p.tempering) {
      const rate = p.thicknessMm == null ? null : ref.get(`temper.price.${p.thicknessMm}`)
      if (!rate) miss('tempering', `нет цены закалки для ${p.thicknessMm ?? '?'} мм`, p.id)
      else lines.push({ label: `Закалка ${p.thicknessMm} мм`, cost: times(rate, net), note: `${round(net)} м², сторонняя услуга` })
    }
    if (p.facet) miss('general', 'фацет — сторонняя услуга: цена не задана, впишите её в прочие прямые', p.id)
    if (layers > 1) miss('general', 'триплексование — сторонняя услуга: цена не задана', p.id)
    if (p.packaging) miss('packaging', 'упаковочные материалы: норма расхода не задана', p.id)

    for (const e of p.extras) {
      if (!(e.amountGross > 0)) continue
      lines.push({
        label: e.label || 'Прочее прямое',
        cost: vatRange(e.amountGross, opts.deductInputVat ? e.vat : 'none'),
        note: 'введено вручную',
      })
    }
  }
  return { lines, missing, uses }
}

const round = (x: number) => Math.round(x * 10000) / 10000
