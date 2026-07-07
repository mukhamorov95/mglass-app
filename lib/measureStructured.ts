// Каноничное сообщение заявки на замер — единый формат для AI-разбора и ручного ввода.

export type MeasureFields = {
  deal_number?: string | null
  client_name?: string | null
  phone?: string | null
  amo_url?: string | null
  address?: string | null
  scope?: string | null
  notes?: string | null
  visit_price?: number | null
  payer?: string | null
  is_repeat?: boolean | null
}

export function buildMeasureStructured(p: MeasureFields): string {
  const lines = [
    `📐 ЗАМЕР ${p.is_repeat ? 'ПОВТОРНЫЙ' : 'НОВЫЙ'}${p.deal_number ? ` · ${p.deal_number}` : ''}`,
    `Клиент: ${p.client_name || '—'}${p.phone ? ` ${p.phone}` : ''}`,
    p.amo_url ? `Amo: ${p.amo_url}` : '',
    `Адрес: ${p.address || '—'}`,
    `Задача: ${p.scope || '—'}`,
    `Выезд: ${Number(p.visit_price) > 0 ? `${Number(p.visit_price).toLocaleString('ru-RU')} ₽` : 'бесплатно'}${p.payer ? ` · платит ${p.payer}` : ''}`,
    p.notes ? `Примечание: ${p.notes}` : '',
  ]
  return lines.filter(Boolean).join('\n')
}
