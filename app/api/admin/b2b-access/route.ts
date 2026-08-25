import { NextResponse } from 'next/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { requireOwner } from '@/lib/apiAuth'
import { createSetupToken } from '@/lib/setupToken'
import { notifyPartnerAccessGranted } from '@/lib/notify'
import { pushNotification } from '@/lib/partnerNotify'

// Выдача доступа в кабинет заказчику (роль partner). Владелец:
//  • видит список B2B-клиентов и кто из них уже привязан к учётке;
//  • выдаёт доступ: создаём auth-учётку, роль partner, привязываем b2b_clients.user_id,
//    возвращаем ссылку set-password (пароль владелец не знает — клиент задаёт сам);
//  • отзывает доступ: снимаем привязку (user_id → null).
// Пароли — только через Supabase Auth (хеши). Никакого password_plain для внешних.

function randomPw(): string {
  const arr = new Uint8Array(24)
  crypto.getRandomValues(arr)
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('')
}
const admin = () => createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

export async function GET() {
  const guard = await requireOwner()
  if (guard instanceof NextResponse) return guard

  const a = admin()
  const { data: clients } = await a.from('b2b_clients')
    .select('id,name,user_id,discount_percent,active').order('name')
  const { data: members } = await a.from('b2b_client_members').select('client_id,user_id')

  // Собираем email по всем причастным учёткам (первичные + участники команды).
  const allIds = [
    ...(clients ?? []).map(c => c.user_id).filter(Boolean) as string[],
    ...(members ?? []).map(m => m.user_id as string),
  ]
  let emails: Record<string, string> = {}
  if (allIds.length) {
    const { data: us } = await a.from('users').select('id,email').in('id', [...new Set(allIds)])
    emails = Object.fromEntries((us ?? []).map(u => [u.id as string, u.email as string]))
  }
  const membersByClient = new Map<number, { userId: string; email: string | null }[]>()
  for (const m of members ?? []) {
    const list = membersByClient.get(m.client_id as number) ?? []
    list.push({ userId: m.user_id as string, email: emails[m.user_id as string] ?? null })
    membersByClient.set(m.client_id as number, list)
  }

  const rows = (clients ?? []).map(c => ({
    id: c.id, name: c.name, discount: c.discount_percent, active: c.active,
    linked: !!c.user_id, email: c.user_id ? (emails[c.user_id as string] ?? null) : null,
    members: membersByClient.get(c.id) ?? [],
  }))
  return NextResponse.json({ clients: rows })
}

export async function POST(req: Request) {
  const guard = await requireOwner()
  if (guard instanceof NextResponse) return guard

  const body = await req.json().catch(() => ({}))
  const a = admin()

  if (body.action === 'unlink') {
    const clientId = Number(body.clientId)
    if (!clientId) return NextResponse.json({ error: 'Нужен клиент' }, { status: 400 })
    const { error } = await a.from('b2b_clients').update({ user_id: null }).eq('id', clientId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  // A6: убрать сотрудника из команды компании (удаляем членство, учётку не трогаем).
  if (body.action === 'remove_member') {
    const clientId = Number(body.clientId)
    const memberId = String(body.userId ?? '')
    if (!clientId || !memberId) return NextResponse.json({ error: 'Нужны клиент и сотрудник' }, { status: 400 })
    const { error } = await a.from('b2b_client_members').delete().eq('client_id', clientId).eq('user_id', memberId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  // Разрешить/запретить клиенту самому скачивать счёт-спецификацию (после проверки паритета).
  if (body.action === 'set_self_invoice') {
    const clientId = Number(body.clientId)
    if (!clientId) return NextResponse.json({ error: 'Нужен клиент' }, { status: 400 })
    const { error } = await a.from('b2b_clients').update({ can_self_invoice: !!body.value }).eq('id', clientId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, value: !!body.value })
  }

  const clientId = Number(body.clientId)
  const email = String(body.email ?? '').trim().toLowerCase()
  if (!clientId || !email) return NextResponse.json({ error: 'Нужны клиент и email' }, { status: 400 })
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({ error: 'Некорректный email' }, { status: 400 })

  const { data: client } = await a.from('b2b_clients').select('id,name,user_id').eq('id', clientId).maybeSingle()
  if (!client) return NextResponse.json({ error: 'Клиент не найден' }, { status: 404 })

  // Учётка: создаём новую или находим существующую по email.
  let userId: string
  const { data: created, error } = await a.auth.admin.createUser({ email, password: randomPw(), email_confirm: true })
  if (error) {
    const { data: list } = await a.auth.admin.listUsers({ perPage: 1000, page: 1 })
    const found = list?.users.find(u => u.email?.toLowerCase() === email)
    if (!found) return NextResponse.json({ error: error.message }, { status: 400 })
    userId = found.id
  } else {
    userId = created.user.id
  }

  // Изоляция: один логин = ровно одна компания. Если email уже привязан к ДРУГОЙ
  // компании (как первичный или участник) — отказываем, чтобы не смешать данные.
  const { data: otherPrimary } = await a.from('b2b_clients').select('id').eq('user_id', userId).neq('id', clientId).maybeSingle()
  const { data: otherMember } = await a.from('b2b_client_members').select('client_id').eq('user_id', userId).maybeSingle()
  if (otherPrimary || (otherMember && otherMember.client_id !== clientId)) {
    return NextResponse.json({ error: 'Этот email уже привязан к другой компании' }, { status: 400 })
  }

  // Роль partner + имя (строка public.users создаётся триггером handle_new_user при createUser).
  await a.from('users').update({ role: 'partner', name: client.name }).eq('id', userId)

  // A6: первый доступ → первичный владелец (b2b_clients.user_id). Последующие → участники команды.
  const asMember = !!client.user_id && client.user_id !== userId
  if (asMember) {
    const { error: memErr } = await a.from('b2b_client_members').upsert(
      { client_id: clientId, user_id: userId }, { onConflict: 'user_id', ignoreDuplicates: true })
    if (memErr) return NextResponse.json({ error: memErr.message }, { status: 500 })
  } else if (!client.user_id) {
    const { error: linkErr } = await a.from('b2b_clients').update({ user_id: userId }).eq('id', clientId)
    if (linkErr) return NextResponse.json({ error: linkErr.message }, { status: 500 })
  }

  const token = await createSetupToken(userId)
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin).replace(/\/$/, '')
  const setupLink = `${base}/set-password?token=${token}`

  // Приветственное уведомление в кабинет + письмо со ссылкой на пароль (best-effort).
  await pushNotification(a, {
    clientId, kind: 'access', title: 'Добро пожаловать в кабинет заказчика',
    body: 'Доступ открыт. Считайте по своим ценам и отправляйте заказы в работу.', link: '/partner',
  }).catch(() => {})
  const emailed = await notifyPartnerAccessGranted({ to: email, clientName: client.name, setupLink }).catch(() => false)

  return NextResponse.json({ ok: true, link: setupLink, emailed, member: asMember })
}
