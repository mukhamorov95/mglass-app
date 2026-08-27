import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { isOwnerRole } from '@/lib/getRole'
import { canonicalOrderIds, orderSetKey } from '@/lib/b2b/invoiceRegistry'
import { remainderStatus } from '@/lib/b2b/orderPayments'

type InvoiceRow = { id: number; order_ids: number[] | null; amount: number | null; status: string }

// Дебиторка — производная от payments (правило проекта), не от ручного флажка
// invoices.status. Оплачено по счёту = невойднутые платежи, привязанные к нему
// напрямую (payments.invoice_id) ИЛИ к его заказам (payments.b2b_order_id из
// order_ids). По контракту с бухгалтерией одно-заказный счёт якорится через
// b2b_order_id, мульти-заказный — через invoice_id, поэтому суммы не двоятся.
// Интерпретацию остатка берём из lib/b2b/orderPayments (A23), вторую не пишем.
async function attachPayments<T extends InvoiceRow>(
  svc: ReturnType<typeof createServiceClient>, invoices: T[],
): Promise<(T & { paid: number; remainder: number; derivedStatus: 'paid' | 'partial' | 'unpaid' })[]> {
  const invIds = invoices.map(i => i.id)
  const orderIds = [...new Set(invoices.flatMap(i => i.order_ids ?? []))]
  const byInvoice = new Map<number, number>()
  const byOrder = new Map<number, number>()
  if (invIds.length || orderIds.length) {
    const { data: pays } = await svc.from('payments')
      .select('amount, invoice_id, b2b_order_id, voided_at')
      .is('voided_at', null)
      .or(`invoice_id.in.(${invIds.join(',') || 0}),b2b_order_id.in.(${orderIds.join(',') || 0})`)
    for (const p of (pays ?? []) as { amount: number; invoice_id: number | null; b2b_order_id: number | null }[]) {
      const amt = Number(p.amount) || 0
      if (p.invoice_id != null) byInvoice.set(p.invoice_id, (byInvoice.get(p.invoice_id) ?? 0) + amt)
      else if (p.b2b_order_id != null) byOrder.set(p.b2b_order_id, (byOrder.get(p.b2b_order_id) ?? 0) + amt)
    }
  }
  return invoices.map(inv => {
    const paid = (byInvoice.get(inv.id) ?? 0)
      + (inv.order_ids ?? []).reduce((s, oid) => s + (byOrder.get(oid) ?? 0), 0)
    const rem = remainderStatus(Number(inv.amount) || 0, paid)
    // «Нет платежей» = unpaid (не «долг»): банковский импорт мог ещё не дойти —
    // ровно как в A23. Оплачено, если платежи покрыли сумму; частично — если
    // есть платёж, но остаток положительный.
    const derivedStatus: 'paid' | 'partial' | 'unpaid' =
      rem.hasPayment && !rem.outstanding ? 'paid'
      : rem.hasPayment ? 'partial'
      : 'unpaid'
    return { ...inv, paid: rem.paid, remainder: rem.remainder, derivedStatus }
  })
}

// Реестр счетов: список / регистрация счёта / смена статуса оплаты.
// RLS уже ограничивает финконтуром; здесь дополнительно проставляем автора.
//
// Регистрация — ИДЕМПОТЕНТНА по набору заказов: печать счёта создаёт запись
// побочным эффектом (см. страницы /b2b-quotes/[id]/invoice и /b2b-orders/invoice),
// и повторная печать не должна плодить дубли и «прыгать» номером. Ключ — не номер
// (менеджер его правит), а сам набор order_ids: один набор заказов = один счёт.

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

// Действующий (не отменённый) счёт, покрывающий РОВНО этот набор заказов.
// PostgREST `contains` находит счета, включающие все эти заказы; точное совпадение
// набора сверяем в коде (длина + равенство), чтобы «счёт на 2 заказа» не спутать
// со «счётом на 1 из них».
async function findExisting(client: ReturnType<typeof createServiceClient>, orderIds: number[]) {
  if (orderIds.length === 0) return null
  const { data } = await client.from('invoices')
    .select('id, invoice_no, order_ids, amount, status')
    .contains('order_ids', orderIds)
    .neq('status', 'cancelled')
    .limit(50)
  const key = orderIds.join(',')
  return (data ?? []).find((inv: { order_ids: number[] | null }) =>
    orderSetKey(inv.order_ids) === key) ?? null
}

export async function GET() {
  const a = await requireAny()
  if ('error' in a) return a.error

  const svc = createServiceClient()

  if (a.fin || a.seeAll) {
    const client = a.fin ? a.sb : svc
    const { data } = await client.from('invoices').select('*').order('id', { ascending: false }).limit(500)
    const invoices = await attachPayments(svc, (data ?? []) as InvoiceRow[])
    return NextResponse.json({ invoices, scope: a.fin ? 'all' : 'all_clients' })
  }

  const clientIds = await managerScope(a.sb, a.user.id)
  const { data } = await svc.from('invoices')
    .select('*')
    .or(`payer_client_id.in.(${clientIds.length ? clientIds.join(',') : '0'}),created_by.eq.${a.user.id}`)
    .order('id', { ascending: false })
    .limit(500)
  const invoices = await attachPayments(svc, (data ?? []) as InvoiceRow[])
  return NextResponse.json({ invoices, scope: 'mine' })
}

export async function POST(req: Request) {
  const a = await requireAny()
  if ('error' in a) return a.error
  const b = await req.json().catch(() => ({})) as {
    invoice_no?: string; payer_client_id?: number | null; payer_entity_id?: number | null; payer_name?: string
    order_ids?: number[]; amount?: number; vat?: number; comment?: string
  }
  const order_ids = canonicalOrderIds(b.order_ids)
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

  const svc = createServiceClient()

  // Идемпотентность: этот набор заказов уже зарегистрирован → возвращаем тот же
  // счёт (тот же id и номер), ничего не создаём и не меняем — документ уже выдан.
  const existing = await findExisting(svc, order_ids)
  if (existing) {
    return NextResponse.json({ ok: true, id: existing.id, invoice_no: existing.invoice_no, existing: true })
  }

  const writer = a.fin ? a.sb : svc
  const invoiceNo = (b.invoice_no ?? '').trim() || order_ids.map(n => String(n)).join('–')
  const { data, error } = await writer.from('invoices').insert({
    invoice_no: invoiceNo,
    payer_client_id: b.payer_client_id ?? null,
    payer_entity_id: b.payer_entity_id ?? null,
    payer_name: b.payer_name ?? null,
    order_ids, amount: b.amount, vat: b.vat ?? 0,
    comment: b.comment ?? null,
    created_by: a.user.id, created_by_name: a.name,
  }).select('id, invoice_no').single()

  if (error) {
    // Гонка двух печатей: уникальный индекс по набору заказов отбил дубль (23505).
    // Не ошибка — возвращаем уже созданный первым запросом счёт.
    if (error.code === '23505') {
      const raced = await findExisting(svc, order_ids)
      if (raced) return NextResponse.json({ ok: true, id: raced.id, invoice_no: raced.invoice_no, existing: true })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true, id: data.id, invoice_no: data.invoice_no, existing: false })
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
