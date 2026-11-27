import type { CostLine, OperationCode } from '../types'
import type { Valued } from '../values'
import { exVat, plus, point, vatKnown, ZERO, type Range, type VatRegime } from './vat'

// Что из сохранённой себестоимости — переменные заказа. Правила и налоговые режимы — версионируемые
// данные: уточнение меняет набор, а не код и не сохранённые позиции.
// own — своя операция: старый тариф не используется, стоимость берётся из ресурсов цеха.
export type Behaviour = 'direct' | 'own' | 'allowance' | 'undefined'

export type PolicyRule = {
  op: OperationCode
  label?: string                      // регулярное выражение по названию строки
  behaviour: Behaviour
  vat: VatRegime
  // Ориентир вместо сохранённой суммы — всегда диапазон за штуку и всегда с источником.
  perPiece?: { lo: Valued; hi: Valued }
}
export type CostPolicy = { id: string; version: number; rules: PolicyRule[] }

export const ruleFor = (policy: CostPolicy, line: Pick<CostLine, 'op' | 'label'>): PolicyRule =>
  policy.rules.find(r => r.op === line.op && (!r.label || new RegExp(r.label, 'i').test(line.label)))
  ?? { op: line.op, behaviour: 'undefined', vat: { kind: 'unknown' } }

export type ClassifiedLine = {
  line: CostLine
  rule: PolicyRule
  stored: number
  cost: Range          // без принимаемого к вычету НДС
  replaced: boolean    // сумма взята из ориентира, а не из позиции
}

export function classify(policy: CostPolicy, line: CostLine, pieces: number): ClassifiedLine {
  const rule = ruleFor(policy, line)
  const stored = line.value.amountGross ?? 0
  const ref = rule.perPiece?.lo.value != null && rule.perPiece.hi.value != null && pieces > 0 ? rule.perPiece : null
  const gross: Range = ref ? { lo: ref.lo.value! * pieces, hi: ref.hi.value! * pieces } : point(stored)
  const net: Range = { lo: exVat(gross.lo, rule.vat).lo, hi: exVat(gross.hi, rule.vat).hi }
  // «Не определено»: может оказаться своей работой (0) или прямой затратой без вычета.
  const cost = rule.behaviour === 'direct' ? net : rule.behaviour === 'undefined' ? { lo: 0, hi: gross.hi } : ZERO
  return { line, rule, stored, cost, replaced: !!ref }
}

export function completeness(lines: ClassifiedLine[]) {
  const direct = lines.filter(l => l.rule.behaviour === 'direct')
  const sum = (xs: ClassifiedLine[]) => xs.reduce((a, l) => a + l.stored, 0)
  return {
    directStored: sum(direct),
    vatUnconfirmed: sum(direct.filter(l => !vatKnown(l.rule.vat))),
    undefinedStored: sum(lines.filter(l => l.rule.behaviour === 'undefined')),
    replaced: sum(lines.filter(l => l.replaced)),
  }
}

export const directCost = (lines: ClassifiedLine[]) => plus(...lines.map(l => l.cost))

export const marginalIncome = (revenueExVat: number, direct: Range, channel: Range): Range =>
  ({ lo: revenueExVat - direct.hi - channel.hi, hi: revenueExVat - direct.lo - channel.lo })
