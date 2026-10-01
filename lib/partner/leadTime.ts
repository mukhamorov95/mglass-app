// Срок изготовления по сложности — то, что партнёр обещает покупателю (решение 01.10.2026).
// Числа — предложение по фактам цеха с августа (отметка «упаковано» от запуска, рабочие дни):
// закалка — 174 заказа, медиана 8, три четверти за 11; простое зеркало — режут на 1-й
// день, упаковано по медиане на 5-й. Владелец хотел 1–2 дня на простое зеркало — это
// возможно только если заказы точек цех ставит первыми. Правка срока — одна строка здесь.
// Срок заказа — по самой сложной позиции. Триплекса в данных нет — срок называет менеджер.

export type LeadSpec = { hasTempering: boolean; hasFacet: boolean; hasHoles: boolean; shape: 'rect' | 'curved'; hasTriplex: boolean }

export type LeadTier = { key: 'simple' | 'processed' | 'tempered'; label: string; min: number; max: number }

export const LEAD_TIERS: readonly LeadTier[] = [
  { key: 'simple', label: 'Зеркало или стекло без закалки: прямой рез, полировка кромки', min: 2, max: 3 },
  { key: 'processed', label: 'Фацет, отверстия, вырезы, фигурный рез — без закалки', min: 3, max: 5 },
  { key: 'tempered', label: 'Закалённое стекло', min: 7, max: 10 },
]

const tierOf = (s: LeadSpec): LeadTier =>
  s.hasTempering ? LEAD_TIERS[2] : (s.hasFacet || s.hasHoles || s.shape === 'curved') ? LEAD_TIERS[1] : LEAD_TIERS[0]

// null — срок не обещаем числом (триплекс или пустой заказ): его подтверждает менеджер.
export function leadTimeFor(specs: LeadSpec[]): { min: number; max: number } | null {
  if (specs.length === 0 || specs.some(s => s.hasTriplex)) return null
  const t = specs.map(tierOf).reduce((a, x) => (x.max > a.max ? x : a))
  return { min: t.min, max: t.max }
}

export function leadTimeText(specs: LeadSpec[]): string {
  const t = leadTimeFor(specs)
  return t ? `${t.min}–${t.max} рабочих дней` : 'срок подтверждаем при заказе'
}
