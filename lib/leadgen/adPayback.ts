// Окупаемость рекламного канала по настройкам цены (financial_settings).
// Цена = Себестоимость / (1 − маржа − налог); статьи менеджер/реализация/маркетинг/транспорт/
// операционные сидят внутри маржи. Значит, реклама канала может съесть долю выручки:
//   по плану      — marketing_percent;
//   до нуля прибыли — маржа минус все статьи, кроме маркетинга.

export type PriceSettings = {
  default_margin: number
  manager_percent: number
  realization_percent: number
  marketing_percent: number
  transport_percent: number
  operation_percent: number
}

export function adShareLimits(s: PriceSettings): { plan: number; breakEven: number } {
  const otherItems = s.manager_percent + s.realization_percent + s.transport_percent + s.operation_percent
  return { plan: s.marketing_percent, breakEven: s.default_margin - otherItems }
}

// Доля выручки канала, ушедшая на его рекламу, %.
export function adShare(spend: number, revenue: number): number | null {
  return revenue > 0 ? (spend / revenue) * 100 : null
}

// Сколько можно заплатить за одну оплаченную сделку при данном чеке и доле, ₽.
export function maxCostPerSale(avgCheck: number, sharePct: number): number {
  return (avgCheck * sharePct) / 100
}

// Сколько канал оставил компании после своей рекламы, ₽: выручка × доля «до нуля прибыли» − расход.
// Отрицательное — канал съел прибыль, которую принесли бы эти продажи.
export function channelProfit(spend: number, revenue: number, s: PriceSettings): number {
  return (revenue * adShareLimits(s).breakEven) / 100 - spend
}
