import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { requireDealActor } from '@/lib/b2c/dealScope'
import { amoGet } from '@/lib/amocrm'
import { phoneKey } from '@/lib/b2c/phoneKey'

export const dynamic = 'force-dynamic'

// Импорт одной заявки из AmoCRM в нашу сделку. Из CRM только ЧИТАЕМ; пишем
// исключительно в свою таблицу deals. Принимает id заявки или ссылку на неё —
// менеджеру проще скопировать адрес карточки из браузера, чем искать число.

type AmoLeadFull = {
  id: number; name: string; status_id: number
  _embedded?: { contacts?: { id: number; is_main?: boolean }[] }
}
type AmoContact = {
  id: number; name: string
  custom_fields_values?: { field_code?: string; values?: { value?: string }[] }[] | null
}

// «https://mglass.amocrm.ru/leads/detail/12345» и «12345» — оба валидны.
function leadIdFrom(input: unknown): number | null {
  const s = String(input ?? '').trim()
  if (!s) return null
  const direct = Number(s)
  if (Number.isFinite(direct) && direct > 0) return direct
  const m = s.match(/(?:detail\/|leads\/)(\d+)/) ?? s.match(/(\d{4,})/)
  return m ? Number(m[1]) : null
}

function fieldValue(c: AmoContact | null, code: string): string {
  const f = c?.custom_fields_values?.find(x => x.field_code === code)
  return String(f?.values?.[0]?.value ?? '').trim()
}

export async function POST(req: NextRequest) {
  const actor = await requireDealActor()
  if (actor instanceof NextResponse) return actor

  const b = await req.json().catch(() => ({})) as { lead?: unknown; source?: string }
  const leadId = leadIdFrom(b.lead)
  if (!leadId) return NextResponse.json({ error: 'Нужен номер заявки или ссылка на неё' }, { status: 400 })

  const svc = createServiceClient()

  // Уже импортирована — открываем существующую сделку, второй карточки не плодим.
  const { data: exists } = await svc.from('deals').select('id').eq('amo_lead_id', String(leadId)).maybeSingle()
  if (exists) return NextResponse.json({ ok: true, id: (exists as { id: number }).id, existed: true })

  let lead: AmoLeadFull | null
  try {
    lead = await amoGet<AmoLeadFull>(`/leads/${leadId}`, { with: 'contacts' })
  } catch (e) {
    return NextResponse.json({ error: `AmoCRM недоступна: ${(e as Error).message}` }, { status: 502 })
  }
  if (!lead) return NextResponse.json({ error: 'Заявка не найдена в AmoCRM' }, { status: 404 })

  // Телефон и имя живут на контакте, а не на сделке.
  const contacts = lead._embedded?.contacts ?? []
  const mainId = (contacts.find(c => c.is_main) ?? contacts[0])?.id
  let contact: AmoContact | null = null
  if (mainId) {
    try { contact = await amoGet<AmoContact>(`/contacts/${mainId}`) } catch { contact = null }
  }
  const phone = fieldValue(contact, 'PHONE')
  const clientName = (contact?.name || lead.name || '').trim()

  const { data, error } = await svc.from('deals').insert({
    client_name: clientName,
    phone,
    phone_key: phoneKey(phone),
    address: '',
    manager_id: actor.userId,
    amo_lead_id: String(leadId),
    source: b.source?.trim() || null,
    created_by: actor.userId,
    created_by_name: actor.name,
  }).select('id').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, id: data.id, name: clientName, phone })
}
