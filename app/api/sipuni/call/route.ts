import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { getSessionUser } from '@/lib/getRole'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { isSipuniConfigured, defaultSipNumber, sipuniCallNumber } from '@/lib/sipuni'

// Позвонить клиенту из CRM: SIPUNI звонит менеджеру (внутренний номер), затем
// набирает клиента и соединяет. reverse=0 — сначала менеджер, потом клиент.

async function myName(): Promise<string | null> {
  const user = await getSessionUser()
  if (!user) return null
  const supabase = await createClient()
  const { data } = await supabase.from('users').select('name').eq('id', user.id).maybeSingle()
  return (data as { name: string | null } | null)?.name ?? user.email ?? null
}

export async function POST(req: NextRequest) {
  const guard = await requireRole(['admin', 'ceo', 'commercial', 'manager'])
  if (guard instanceof NextResponse) return guard
  if (!isSipuniConfigured()) {
    return NextResponse.json({ error: 'SIPUNI не настроен', hint: 'Добавьте env SIPUNI_ID, SIPUNI_API_KEY, SIPUNI_DEFAULT_SIPNUMBER в Vercel.' }, { status: 400 })
  }

  let body: { lead_id?: number; phone?: string; sipnumber?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }) }

  const sb = createServiceClient()
  let phone = (body.phone ?? '').trim()
  const leadId = Number(body.lead_id) || null
  if (leadId && !phone) {
    const { data } = await sb.from('crm_leads').select('phone').eq('id', leadId).maybeSingle()
    phone = ((data as { phone: string | null } | null)?.phone ?? '').trim()
  }
  if (!phone) return NextResponse.json({ error: 'нет телефона у лида — клиент ещё не оставил номер' }, { status: 400 })

  const sipnumber = (body.sipnumber || defaultSipNumber() || '').trim()
  if (!sipnumber) return NextResponse.json({ error: 'не задан внутренний номер (SIPUNI_DEFAULT_SIPNUMBER)' }, { status: 400 })

  let result
  try {
    result = await sipuniCallNumber(phone, sipnumber)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }

  if (leadId) {
    const me = await myName()
    await sb.from('crm_lead_events').insert({
      lead_id: leadId, kind: 'call',
      text: `📞 Звонок инициирован (SIPUNI) на ${phone}`, author: me,
    })
  }

  return NextResponse.json({ ok: result.ok, sipuni: result.body })
}
