import { NextResponse } from 'next/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { requireOwner } from '@/lib/apiAuth'
import { pageAll } from '@/lib/supabase/pageAll'

// Сводка B2B-клиентов для админ-справочника. По каждому клиенту:
//  • базовые поля (имя/контакт/телефон/скидка/активность/примечание);
//  • агрегаты по РЕАЛЬНЫМ заказам — launched_at IS NOT NULL (просчёты НЕ считаем):
//    кол-во заказов, сумма всего, сумма за текущий год, дата последнего заказа;
//  • статус доступа в кабинет (привязана ли учётка + email).
// Владелец-only, service-role (агрегаты по всем клиентам разом).

const admin = () => createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

type OrderRow = { client_id: number | null; total_after_discount: number | null; created_at: string | null }

export async function GET() {
  const guard = await requireOwner()
  if (guard instanceof NextResponse) return guard
  const a = admin()

  // Заказы за всё время — страницами: без них PostgREST отдавал 1000 случайных из ~4600
  // запущенных, и счётчики/суммы клиентов были занижены.
  const [{ data: clients }, ordersRes, { data: members }] = await Promise.all([
    a.from('b2b_clients').select('id,name,contact,phone,discount_percent,active,notes,user_id,can_self_invoice'),
    pageAll<OrderRow>((from, to) => a.from('b2b_orders').select('client_id,total_after_discount,created_at')
      .not('launched_at', 'is', null).order('id').range(from, to))
      .then(rows => ({ rows, error: null as string | null }), (e: Error) => ({ rows: [] as OrderRow[], error: e.message as string | null })),
    a.from('b2b_client_members').select('client_id,user_id'),
  ])
  if (ordersRes.error) return NextResponse.json({ error: `Заказы B2B: ${ordersRes.error}` }, { status: 500 })

  const year = new Date().getFullYear()
  type Agg = { count: number; sum: number; sumYear: number; last: string | null }
  const agg = new Map<number, Agg>()
  for (const o of ordersRes.rows) {
    if (o.client_id == null) continue
    const g = agg.get(o.client_id) ?? { count: 0, sum: 0, sumYear: 0, last: null }
    const amt = Number(o.total_after_discount) || 0
    g.count += 1
    g.sum += amt
    if (o.created_at && new Date(o.created_at).getFullYear() === year) g.sumYear += amt
    if (o.created_at && (!g.last || o.created_at > g.last)) g.last = o.created_at
    agg.set(o.client_id, g)
  }

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

  const rows = (clients ?? []).map(c => {
    const g = agg.get(c.id) ?? { count: 0, sum: 0, sumYear: 0, last: null }
    return {
      id: c.id, name: c.name, contact: c.contact, phone: c.phone,
      discount: Number(c.discount_percent) || 0, active: c.active, notes: c.notes,
      ordersCount: g.count, sumTotal: g.sum, sumYear: g.sumYear, lastOrderAt: g.last,
      linked: !!c.user_id, email: c.user_id ? (emails[c.user_id as string] ?? null) : null,
      canSelfInvoice: !!c.can_self_invoice,
      members: membersByClient.get(c.id) ?? [],
    }
  })

  // Приглашённые партнёры без компании (role=partner, не первичный и не участник) —
  // дыра онбординга: инвайт ставит роль, но не привязывает к b2b_clients.
  const linkedUserIds = new Set(allIds)
  const { data: partnerUsers } = await a.from('users').select('id,email,name').eq('role', 'partner')
  const unlinkedPartners = (partnerUsers ?? [])
    .filter(u => !linkedUserIds.has(u.id as string))
    .map(u => ({ userId: u.id as string, email: (u.email as string | null) ?? null, name: (u.name as string | null) ?? null }))

  return NextResponse.json({ clients: rows, year, unlinkedPartners })
}
