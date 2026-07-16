import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { getSessionUser } from '@/lib/getRole'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { isOnlinePbxConfigured, onlinePbxDefaultExt, onlinePbxCall } from '@/lib/onlinepbx'
import { isSipuniConfigured, defaultSipNumber, sipuniCallNumber } from '@/lib/sipuni'

// Единая кнопка «Позвонить» из CRM. Провайдер выбирается по env: если настроен
// OnlinePBX — звоним через него, иначе фолбэк на SIPUNI. Переключение кабинета —
// сменой переменных окружения, без правок фронта. Схема одинаковая: АТС звонит
// менеджеру на внутренний номер, затем набирает клиента и соединяет.

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

  const onlinePbx = isOnlinePbxConfigured()
  const sipuni = isSipuniConfigured()
  if (!onlinePbx && !sipuni) {
    return NextResponse.json({
      error: 'Телефония не настроена',
      hint: 'Добавьте env ONLINEPBX_DOMAIN + ONLINEPBX_API_KEY + ONLINEPBX_DEFAULT_EXT (или SIPUNI_*) в Vercel.',
    }, { status: 400 })
  }

  let body: { lead_id?: number; phone?: string; ext?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }) }

  const sb = createServiceClient()
  let phone = (body.phone ?? '').trim()
  const leadId = Number(body.lead_id) || null
  if (leadId && !phone) {
    const { data } = await sb.from('crm_leads').select('phone').eq('id', leadId).maybeSingle()
    phone = ((data as { phone: string | null } | null)?.phone ?? '').trim()
  }
  if (!phone) return NextResponse.json({ error: 'нет телефона у лида — клиент ещё не оставил номер' }, { status: 400 })

  const provider = onlinePbx ? 'onlinepbx' : 'sipuni'
  const ext = (body.ext || (onlinePbx ? onlinePbxDefaultExt() : defaultSipNumber()) || '').trim()
  if (!ext) {
    return NextResponse.json({ error: onlinePbx ? 'не задан внутренний номер (ONLINEPBX_DEFAULT_EXT)' : 'не задан внутренний номер (SIPUNI_DEFAULT_SIPNUMBER)' }, { status: 400 })
  }

  let ok = false
  let raw: unknown
  try {
    if (onlinePbx) { const r = await onlinePbxCall(phone, ext); ok = r.ok; raw = r.body }
    else { const r = await sipuniCallNumber(phone, ext); ok = r.ok; raw = r.body }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }

  if (leadId) {
    const me = await myName()
    const text = `📞 Звонок инициирован (${provider === 'onlinepbx' ? 'OnlinePBX' : 'SIPUNI'}) на ${phone}`
    const { error } = await sb.from('crm_lead_events').insert({
      lead_id: leadId, kind: 'call', author: me, text, meta: { provider, direction: 'out' },
    })
    if (error && /meta/i.test(error.message || '')) {
      await sb.from('crm_lead_events').insert({ lead_id: leadId, kind: 'call', author: me, text })
    }
  }

  return NextResponse.json({ ok, provider, result: raw })
}
