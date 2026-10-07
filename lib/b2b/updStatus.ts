// УПД в списке B2B-заказов (этап 9 docs/b2b/ORDER_PANEL_ROUTE.md): у заказа виден номер
// выданного УПД, а у отгруженного без УПД — призыв выдать. Призыв только там, где УПД нужен
// (у клиента есть ИНН) и где его можно выдать (бухгалтер включил серию на год): иначе кнопка
// висела бы у розницы M GLASS и частных заказчиков, которым УПД не выдаётся.

export type UpdIssuedShort = { number: number; year: number; doc_date: string }

export type UpdStatus = {
  issued: Record<number, UpdIssuedShort>
  eligible: number[]          // заказы, у клиента которых есть ИНН
  // switchDay — день включения серии текущего года (по Москве): отгрузки раньше него закрыты
  // программой бухгалтера, «Мой день» их не предлагает. Нет поля — группа «Выдать УПД» молчит.
  series: { pendingSql: boolean; set: boolean; switchDay?: string | null }
}

export type UpdCardState =
  | { kind: 'issued'; number: number; docDate: string }
  | { kind: 'issue' }
  | { kind: 'none' }

export function updCardState(orderId: number, shipped: boolean, s: UpdStatus | null): UpdCardState {
  if (!s) return { kind: 'none' }
  const iss = s.issued[orderId]
  if (iss) return { kind: 'issued', number: iss.number, docDate: iss.doc_date }
  if (shipped && s.series.set && !s.series.pendingSql && s.eligible.includes(orderId)) return { kind: 'issue' }
  return { kind: 'none' }
}
