import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { canAccessRoute } from '@/lib/getRole'
import {
  normalizeInquiryInput, hasWho, statusPatch, isInquiryStatus, inquiryTitle, OPEN_STATUSES,
  type Inquiry,
} from '@/lib/b2b/inquiries'
import { inquiryNotifyText } from '@/lib/b2b/avitoInquiry'
import { notifyInquiryRecipients } from '@/lib/b2b/inquiryNotify'

export const dynamic = 'force-dynamic'

// Входящие заявки B2B. Читаем и пишем под RLS вошедшего (политики миграции
// 20261002_b2b_inquiries.sql): владелец видит весь поток, сотрудник — свои и назначенные.
// Гейт роли здесь тот же, что у страницы: /api не наследует гейт экрана.

const COLS = 'id, created_at, updated_at, source, contact_name, company, phone, request, chat_url, listing, status, answered_at, closed_at, lost_reason, b2b_client_id, created_by, assigned_to, avito_chat_id, last_message_at'

async function gate() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return { err: NextResponse.json({ error: 'Нужно войти' }, { status: 401 }) } as const
  const { data: profile, error } = await sb.from('users').select('role, manager_code').eq('id', user.id).maybeSingle()
  if (error) return { err: NextResponse.json({ error: `Профиль не прочитан: ${error.message}` }, { status: 500 }) } as const
  if (!canAccessRoute(profile?.role as string | undefined, '/b2b-crm/inquiries')) {
    return { err: NextResponse.json({ error: 'Нет доступа к заявкам' }, { status: 403 }) } as const
  }
  return { sb, user, managerCode: (profile?.manager_code as number | null) ?? null } as const
}

export async function GET(req: NextRequest) {
  const g = await gate()
  if ('err' in g) return g.err
  const status = req.nextUrl.searchParams.get('status') ?? 'open'
  let q = g.sb.from('b2b_inquiries').select(COLS).order('created_at', { ascending: false }).limit(300)
  if (status === 'open') q = q.in('status', OPEN_STATUSES)
  else if (isInquiryStatus(status)) q = q.eq('status', status)
  else if (status !== 'all') return NextResponse.json({ error: 'Неизвестный статус' }, { status: 400 })
  const { data, error } = await q
  if (error) return NextResponse.json({ error: `Заявки не прочитаны: ${error.message}` }, { status: 500 })
  return NextResponse.json({ inquiries: data ?? [], me: g.user.id })
}

export async function POST(req: NextRequest) {
  const g = await gate()
  if ('err' in g) return g.err
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Пустой запрос' }, { status: 400 })
  const n = normalizeInquiryInput(body as Record<string, unknown>)
  if (!n.ok) return NextResponse.json({ error: n.error }, { status: 400 })
  if (!hasWho(n.value)) return NextResponse.json({ error: 'Укажите имя, компанию, телефон или ссылку на чат' }, { status: 400 })
  const { data, error } = await g.sb.from('b2b_inquiries')
    .insert({ source: 'avito', ...n.value, created_by: g.user.id })
    .select(COLS).single()
  if (error) return NextResponse.json({ error: `Заявка не сохранена: ${error.message}` }, { status: 500 })
  // Тот, кто завёл заявку, о ней уже знает — уведомляем остальных получателей.
  await notifyInquiryRecipients(inquiryNotifyText(data as unknown as Inquiry, 'new'), g.user.id)
    .catch(e => console.error('[inquiries] уведомление не отправлено', e))
  return NextResponse.json({ inquiry: data })
}

// action: 'status' — смена статуса; 'edit' — поля; 'convert' — карточка клиента с источником заявки.
export async function PATCH(req: NextRequest) {
  const g = await gate()
  if ('err' in g) return g.err
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  const id = Number(body?.id)
  if (!body || !Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Нет номера заявки' }, { status: 400 })

  const { data: cur, error: curErr } = await g.sb.from('b2b_inquiries').select(COLS).eq('id', id).maybeSingle()
  if (curErr) return NextResponse.json({ error: `Заявка не прочитана: ${curErr.message}` }, { status: 500 })
  // RLS молчит: чужая заявка выглядит как отсутствующая.
  if (!cur) return NextResponse.json({ error: 'Заявка не найдена' }, { status: 404 })
  const inq = cur as unknown as Inquiry

  let patch: Record<string, unknown>
  if (body.action === 'status') {
    if (!isInquiryStatus(body.status)) return NextResponse.json({ error: 'Неизвестный статус' }, { status: 400 })
    const reason = typeof body.lost_reason === 'string' ? body.lost_reason.trim().slice(0, 300) || null : null
    patch = statusPatch(inq, body.status, new Date().toISOString(), reason)
  } else if (body.action === 'edit') {
    const n = normalizeInquiryInput((body.fields ?? {}) as Record<string, unknown>)
    if (!n.ok) return NextResponse.json({ error: n.error }, { status: 400 })
    if (!hasWho({ ...inq, ...n.value })) return NextResponse.json({ error: 'У заявки должен остаться кто-то, кому ответить' }, { status: 400 })
    patch = n.value
  } else if (body.action === 'convert') {
    if (inq.b2b_client_id) return NextResponse.json({ inquiry: inq, clientId: inq.b2b_client_id, linked: true })
    const name = inquiryTitle(inq)
    // Клиент с таким же названием уже есть — привязываем, а не плодим дубль.
    const { data: same, error: sameErr } = await g.sb.from('b2b_clients').select('id')
      .ilike('name', name.replace(/[%_\\]/g, m => `\\${m}`)).limit(1)
    if (sameErr) return NextResponse.json({ error: `Клиенты не прочитаны: ${sameErr.message}` }, { status: 500 })
    let clientId = same?.[0]?.id as number | undefined
    const linked = !!clientId
    if (!clientId) {
      const { data: created, error: cErr } = await g.sb.from('b2b_clients').insert({
        name,
        contact: inq.contact_name,
        phone: inq.phone,
        crm_source: inq.source,
        crm_status: 'new',
        crm_notes: inq.request ? inq.request.slice(0, 500) : null,
        manager_id: g.user.id,
        manager_code: g.managerCode,
      }).select('id').single()
      if (cErr) return NextResponse.json({ error: `Клиент не создан: ${cErr.message}` }, { status: 500 })
      clientId = created.id as number
    }
    patch = { b2b_client_id: clientId }
    const { data, error } = await g.sb.from('b2b_inquiries').update(patch).eq('id', id).select(COLS).maybeSingle()
    if (error || !data) return NextResponse.json({ error: `Заявка не обновлена: ${error?.message ?? 'нет доступа'}` }, { status: 500 })
    return NextResponse.json({ inquiry: data, clientId, linked })
  } else {
    return NextResponse.json({ error: 'Неизвестное действие' }, { status: 400 })
  }

  const { data, error } = await g.sb.from('b2b_inquiries').update(patch).eq('id', id).select(COLS).maybeSingle()
  if (error) return NextResponse.json({ error: `Заявка не обновлена: ${error.message}` }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Нет доступа к заявке' }, { status: 403 })
  return NextResponse.json({ inquiry: data })
}
