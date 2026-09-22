// Кому принадлежит пропущенный звонок: чья это сделка в amo, на чей телефон шёл звонок
// и связался ли с клиентом хоть кто-то после. Первый разбор 22.09: из пяти клиентов
// без перезвона один — горячая сделка Алины (КП отправлено), двое — новые номера, которые
// АТС отдала Семёну (внутренний по умолчанию), один — свежая заявка Александры, один —
// номер, которого в amo нет вовсе. Чистые функции — данные собирает lib/pbxCallsFetch.ts.

export type AmoContactHit = { id: number; name: string; responsible_user_id: number; leads: number[] }
export type AmoLeadHit = { id: number; name: string; responsible_user_id: number; pipeline_id: number; status_id: number; updated_at: number }
export type TouchEvent = { type: string; created_by: number; created_at: number }

export type MissedClient = {
  phone: string
  at: number
  attempts: number
  rangTo: string[]
  rangToIds: number[]
  owner:
    | { kind: 'deal'; leadId: number; leadName: string; responsible: string; responsibleId: number; stage: string; url: string; autoCreated: boolean }
    | { kind: 'contact'; contactName: string; responsible: string; responsibleId: number; url: string; autoCreated: boolean }
    | { kind: 'none' }
  after: { at: number; what: 'звонок' | 'сообщение'; by: string } | null
}

// amo сам заводит контакт «Пропущенный 7965…», когда звонит незнакомый номер
const AUTO = /^пропущенный/i

export function describeMissedClient(input: {
  item: { at: number; phone: string; attempts: number; exts: string[] }
  contacts: AmoContactHit[]
  leads: Map<number, AmoLeadHit>
  names: Map<number, string>
  stageNames: Map<string, string>
  extToUser: Map<string, number>
  amoRang: number[]
  touches: TouchEvent[]
  domain: string
}): MissedClient {
  const { item, names } = input
  const name = (id: number) => names.get(id) ?? `amo #${id}`

  const rangTo: string[] = []
  const rangToIds: number[] = []
  const add = (n: string, id?: number) => {
    if (!rangTo.includes(n)) rangTo.push(n)
    if (id && !rangToIds.includes(id)) rangToIds.push(id)
  }
  for (const id of input.amoRang) if (id) add(name(id), id)
  for (const ext of item.exts) {
    const uid = input.extToUser.get(ext)
    // Внутренний без человека (5200) — общая линия/группа: такой пропуск amo не записывает вовсе
    add(uid ? name(uid) : `общая линия (вн. ${ext})`, uid)
  }

  let owner: MissedClient['owner'] = { kind: 'none' }
  const leads = input.contacts.flatMap(c => c.leads).map(id => input.leads.get(id)).filter((l): l is AmoLeadHit => !!l)
  // живая сделка важнее закрытой: на неё клиент и звонит
  const lead = leads.sort((a, b) => Number(a.status_id === 143 || a.status_id === 142) - Number(b.status_id === 143 || b.status_id === 142) || b.updated_at - a.updated_at)[0]
  const contact = input.contacts[0]
  if (lead) {
    owner = {
      kind: 'deal', leadId: lead.id, leadName: lead.name, responsible: name(lead.responsible_user_id), responsibleId: lead.responsible_user_id,
      stage: input.stageNames.get(`${lead.pipeline_id}:${lead.status_id}`) ?? `этап ${lead.status_id}`,
      url: `https://${input.domain}/leads/detail/${lead.id}`,
      autoCreated: AUTO.test(lead.name) || input.contacts.some(c => AUTO.test(c.name)),
    }
  } else if (contact) {
    owner = {
      kind: 'contact', contactName: contact.name, responsible: name(contact.responsible_user_id), responsibleId: contact.responsible_user_id,
      url: `https://${input.domain}/contacts/detail/${contact.id}`, autoCreated: AUTO.test(contact.name),
    }
  }

  const touch = input.touches.filter(t => t.created_at >= item.at).sort((a, b) => a.created_at - b.created_at)[0]
  return {
    phone: item.phone,
    at: item.at,
    attempts: item.attempts,
    rangTo,
    rangToIds,
    owner,
    after: touch
      ? { at: touch.created_at, what: touch.type === 'outgoing_call' ? 'звонок' : 'сообщение', by: touch.created_by ? name(touch.created_by) : 'без автора' }
      : null,
  }
}
