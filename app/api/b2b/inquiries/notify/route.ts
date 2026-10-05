import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { requireOwner } from '@/lib/apiAuth'
import { canAccessRoute } from '@/lib/getRole'

export const dynamic = 'force-dynamic'

// Кому приходят уведомления о входящих заявках в Telegram. Список ведёт только владелец:
// получатель видит в уведомлении телефоны и запросы клиентов из любого канала.

export async function GET() {
  const gate = await requireOwner()
  if (gate instanceof NextResponse) return gate
  const sb = await createClient()
  const [{ data: users, error: uErr }, { data: on, error: nErr }] = await Promise.all([
    sb.from('users').select('id, name, email, role, active').order('name'),
    sb.from('b2b_inquiry_notify').select('user_id'),
  ])
  if (uErr || nErr) return NextResponse.json({ error: `Не прочитано: ${(uErr ?? nErr)!.message}` }, { status: 500 })
  // telegram_users — после проверки владельца, service-role'ом: нужна только отметка «бот привязан».
  const { data: tg, error: tgErr } = await createServiceClient().from('telegram_users').select('user_id')
  if (tgErr) return NextResponse.json({ error: `Telegram не прочитан: ${tgErr.message}` }, { status: 500 })
  const linked = new Set((tg ?? []).map(r => r.user_id as string))
  const enabled = new Set((on ?? []).map(r => r.user_id as string))
  const people = (users ?? [])
    .filter(u => u.active !== false && canAccessRoute(u.role as string, '/b2b-crm/inquiries'))
    .map(u => ({
      id: u.id as string, name: (u.name as string | null) || (u.email as string), role: u.role as string,
      telegram: linked.has(u.id as string), on: enabled.has(u.id as string),
    }))
  return NextResponse.json({ people })
}

export async function PUT(req: NextRequest) {
  const gate = await requireOwner()
  if (gate instanceof NextResponse) return gate
  const body = await req.json().catch(() => null) as { user_id?: unknown; on?: unknown } | null
  const userId = typeof body?.user_id === 'string' ? body.user_id : ''
  if (!/^[0-9a-f-]{36}$/i.test(userId) || typeof body?.on !== 'boolean') {
    return NextResponse.json({ error: 'Нужны user_id и on' }, { status: 400 })
  }
  const sb = await createClient()
  const { data: target, error: tErr } = await sb.from('users').select('role').eq('id', userId).maybeSingle()
  if (tErr) return NextResponse.json({ error: `Пользователь не прочитан: ${tErr.message}` }, { status: 500 })
  if (!target || !canAccessRoute(target.role as string, '/b2b-crm/inquiries')) {
    return NextResponse.json({ error: 'Этой роли заявки недоступны' }, { status: 400 })
  }
  const q = body.on
    ? sb.from('b2b_inquiry_notify').upsert({ user_id: userId }, { onConflict: 'user_id', ignoreDuplicates: true }).select('user_id')
    : sb.from('b2b_inquiry_notify').delete().eq('user_id', userId).select('user_id')
  const { error } = await q
  if (error) return NextResponse.json({ error: `Не сохранено: ${error.message}` }, { status: 500 })
  return NextResponse.json({ ok: true })
}
