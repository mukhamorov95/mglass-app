import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { isOwnerRole } from '@/lib/getRole'

// Реестр счетов: список / сохранение единого счёта / смена статуса оплаты.
// RLS уже ограничивает финконтуром; здесь дополнительно проставляем автора.

const FIN_ROLES = ['admin', 'ceo', 'cfo', 'accountant', 'commercial']

// А10: менеджер работает с тем же реестром, но видит только счета своих клиентов.
// RLS на invoices открыта финконтуру, поэтому для менеджера читаем сервис-клиентом
// и режем выборку сами — по списку его клиентов и по авторству счёта.
async function managerScope(sb: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const { data } = await sb.from('b2b_clients').select('id').eq('manager_id', userId)
  return (data ?? []).map((c: { id: number }) => c.id)
}

async function requireAny() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { data: profile } = await sb.from('users').select('role, name, can_view_all_clients').eq('id', user.id).maybeSingle()
  const role = (profile?.role as string | undefined) ?? ''
  const fin = isOwnerRole(role) || FIN_ROLES.includes(role)
  if (!fin && role !== 'manager') {
    return { error: NextResponse.json({ error: 'Недостаточно прав' }, { status: 403 }) }
  }
  return {
    sb, user, fin, role,
    seeAll: fin || profile?.can_view_all_clients === true,
    name: (profile?.name as string) || user.email || null,
  }
}

async function requireFin() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { data: profile } = await sb.from('users').select('role, name').eq('id', user.id).maybeSingle()
  const role = profile?.role as string | undefined
  if (!isOwnerRole(role) && !FIN_ROLES.includes(role ?? '')) {
    return { error: NextResponse.json({ error: 'Недостаточно прав' }, { status: 403 }) }
  }
  return { sb, user, name: (profile?.name as string) || user.email || null }
}

export async function GET() {
  const a = await requireAny()
  if ('error' in a) return a.error

  if (a.fin || a.seeAll) {
    const client = a.fin ? a.sb : createServiceClient()
    const { data } = await client.from('invoices').select('*').order('id', { ascending: false }).limit(500)
    return NextResponse.json({ invoices: data ?? [], scope: a.fin ? 'all' : 'all_clients' })
  }

  const clientIds = await managerScope(a.sb, a.user.id)
  const svc = createServiceClient()
  const { data } = await svc.from('invoices')
    .select('*')
    .or(`payer_client_id.in.(${clientIds.length ? clientIds.join(',') : '0'}),created_by.eq.${a.user.id}`)
    .order('id', { ascending: false })
    .limit(500)
  return NextResponse.json({ invoices: data ?? [], scope: 'mine' })
}

export async function POST(req: Request) {
  const a = await requireAny()
  if ('error' in a) return a.error
  const b = await req.json().catch(() => ({})) as {
    invoice_no?: string; payer_client_id?: number | null; payer_entity_id?: number | null; payer_name?: string
    order_ids?: number[]; amount?: number; vat?: number; comment?: string
  }
  const order_ids = (b.order_ids ?? []).map(Number).filter(n => n > 0)
  if (!(b.amount != null && b.amount >= 0) || !order_ids.length) {
    return NextResponse.json({ error: 'Нужны сумма и заказы' }, { status: 400 })
  }
  // Менеджер может выставить счёт только своему клиенту — проверяем до записи.
  if (!a.fin && !a.seeAll) {
    const clientIds = await managerScope(a.sb, a.user.id)
    if (!b.payer_client_id || !clientIds.includes(Number(b.payer_client_id))) {
      return NextResponse.json({ error: 'Счёт можно выставить только своему клиенту' }, { status: 403 })
    }
  }
  const writer = a.fin ? a.sb : createServiceClient()
  const { data, error } = await writer.from('invoices').insert({
    invoice_no: (b.invoice_no ?? '').trim() || '—',
    payer_client_id: b.payer_client_id ?? null,
    payer_entity_id: b.payer_entity_id ?? null,
    payer_name: b.payer_name ?? null,
    order_ids, amount: b.amount, vat: b.vat ?? 0,
    comment: b.comment ?? null,
    created_by: a.user.id, created_by_name: a.name,
  }).select('id').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, id: data.id })
}

export async function PATCH(req: Request) {
  const a = await requireFin()
  if ('error' in a) return a.error
  const b = await req.json().catch(() => ({})) as { id?: number; status?: string; paid_at?: string | null }
  if (!b.id) return NextResponse.json({ error: 'Нет id' }, { status: 400 })
  if (b.status && !['issued', 'paid', 'cancelled'].includes(b.status)) {
    return NextResponse.json({ error: 'Плохой статус' }, { status: 400 })
  }
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (b.status) {
    patch.status = b.status
    // Оплачен → фиксируем дату; снятие оплаты → чистим.
    if (b.status === 'paid') patch.paid_at = b.paid_at ?? new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' })
    else patch.paid_at = null
  }
  const { error } = await a.sb.from('invoices').update(patch).eq('id', b.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
