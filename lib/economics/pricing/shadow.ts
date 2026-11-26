import { weakest, type Status, type Valued } from '../values'

// Теневой режим: модуль не читает и не пишет прайс, справочники и заказы. Всё в рублях без НДС.
export type PolicyMode = 'free' | 'normal' | 'deficit'
export const MODE_LABEL: Record<PolicyMode, string> = { free: 'свободная мощность', normal: 'нормальная загрузка', deficit: 'дефицит мощности' }

export type FloorInput = {
  variable: Valued                   // Н0: переменные производства и канала
  allocatedFixed: Valued             // ресурсы и постоянные, приходящиеся на часы заказа
  bottleneckHours: number
  displacedPerBottleneckHour: Valued // МД вытесняемых заказов на час узкого места
  normsStatus: Status
  gaps: string[]                     // чего не хватило в объёмах, расходах и затратах канала
}

export type Recommendation = {
  kind: 'preliminary'                // не цена: утверждённая цена — отдельная запись
  mode: PolicyMode
  floorVariable: number | null       // Н0
  floorSustainable: number | null    // Н2
  floorDisplacement: number | null   // Нт
  suggested: number | null           // не ниже Н2, при дефиците не ниже max(Н2, Нт)
  minForDecision: number | null      // ниже этого заказ в данном режиме не брать
  status: Status
  incomplete: string[]
  stamps: Record<string, string>
}

export function recommend(mode: PolicyMode, i: FloorInput, stamps: Record<string, string>): Recommendation {
  const h0 = i.variable.value
  const h2 = h0 != null && i.allocatedFixed.value != null ? h0 + i.allocatedFixed.value : null
  const displaced = i.displacedPerBottleneckHour.value
  const ht = h0 != null && (i.bottleneckHours === 0 || displaced != null) ? h0 + i.bottleneckHours * (displaced ?? 0) : null
  const guarded = mode === 'deficit' ? (h2 != null && ht != null ? Math.max(h2, ht) : null) : h2
  const used: Status[] = [i.variable.status, i.normsStatus, i.allocatedFixed.status]
  if (mode === 'deficit' && i.bottleneckHours > 0) used.push(i.displacedPerBottleneckHour.status)
  return {
    kind: 'preliminary', mode,
    floorVariable: h0, floorSustainable: h2, floorDisplacement: ht,
    suggested: guarded == null ? null : Math.ceil(guarded),
    // При свободной мощности вклад дают и заказы выше Н0, но брать ли такой — решает человек.
    minForDecision: mode === 'free' ? (h0 == null ? null : Math.ceil(h0)) : guarded == null ? null : Math.ceil(guarded),
    // Пропуски не делают весь расчёт «пустым»: он помечен неполным, статус — слабейший из имеющихся.
    status: guarded == null ? 'missing' : weakest(used.filter(s => s !== 'missing').concat(i.gaps.length ? 'hypothesis' : [])),
    incomplete: i.gaps, stamps,
  }
}

export type ApprovedPrice = {
  kind: 'approved'
  priceExVat: number
  approvedBy: string
  approvedAt: string
  basis: { mode: PolicyMode; status: Status; stamps: Record<string, string> }
  belowMinimumReason: string | null
}

// Утверждает только человек и только цену, которую ввёл сам: из рекомендации она не подставляется.
export function approvePrice(rec: Recommendation, d: {
  priceExVat: number; approvedBy: string; approvedAt: string; acknowledgedStatus?: Status; belowMinimumReason?: string
}): ApprovedPrice {
  if (!d.approvedBy.trim()) throw new Error('не указан, кто утверждает цену')
  if (!(d.priceExVat > 0)) throw new Error('цена не задана')
  if ((rec.status === 'hypothesis' || rec.status === 'missing') && d.acknowledgedStatus !== rec.status) {
    throw new Error('расчёт стоит на неподтверждённых входах: статус нужно принять явно')
  }
  const below = rec.minForDecision == null || d.priceExVat < rec.minForDecision
  if (below && !d.belowMinimumReason?.trim()) throw new Error('цена ниже минимума режима или минимум неизвестен: нужна причина')
  return {
    kind: 'approved', priceExVat: d.priceExVat, approvedBy: d.approvedBy, approvedAt: d.approvedAt,
    basis: { mode: rec.mode, status: rec.status, stamps: rec.stamps },
    belowMinimumReason: below ? d.belowMinimumReason!.trim() : null,
  }
}

// МД на час узкого места по заказам, которые его занимают: заданный перцентиль — «что вытесняем».
export function displacedRate(orders: { contribution: number; bottleneckHours: number }[], percentile: number): number | null {
  const rates = orders.filter(o => o.bottleneckHours > 0).map(o => o.contribution / o.bottleneckHours).sort((a, b) => a - b)
  if (!rates.length) return null
  return rates[Math.min(rates.length - 1, Math.max(0, Math.round(percentile / 100 * (rates.length - 1))))]
}
