import { NextResponse } from 'next/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { requireOwner } from '@/lib/apiAuth'

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

  const [{ data: clients }, { data: orders }] = await Promise.all([
    a.from('b2b_clients').select('id,name,contact,phone,discount_percent,active,notes,user_id'),
    a.from('b2b_orders').select('client_id,total_after_discount,created_at').not('launched_at', 'is', null),
  ])

  const year = new Date().getFullYear()
  type Agg = { count: number; sum: number; sumYear: number; last: string | null }
  const agg = new Map<number, Agg>()
  for (const o of (orders ?? []) as OrderRow[]) {
    if (o.client_id == null) continue
    const g = agg.get(o.client_id) ?? { count: 0, sum: 0, sumYear: 0, last: null }
    const amt = Number(o.total_after_discount) || 0
    g.count += 1
    g.sum += amt
    if (o.created_at && new Date(o.created_at).getFullYear() === year) g.sumYear += amt
    if (o.created_at && (!g.last || o.created_at > g.last)) g.last = o.created_at
    agg.set(o.client_id, g)
  }

  const linkedIds = (clients ?? []).map(c => c.user_id).filter(Boolean) as string[]
  let emails: Record<string, string> = {}
  if (linkedIds.length) {
    const { data: us } = await a.from('users').select('id,email').in('id', linkedIds)
    emails = Object.fromEntries((us ?? []).map(u => [u.id as string, u.email as string]))
  }

  const rows = (clients ?? []).map(c => {
    const g = agg.get(c.id) ?? { count: 0, sum: 0, sumYear: 0, last: null }
    return {
      id: c.id, name: c.name, contact: c.contact, phone: c.phone,
      discount: Number(c.discount_percent) || 0, active: c.active, notes: c.notes,
      ordersCount: g.count, sumTotal: g.sum, sumYear: g.sumYear, lastOrderAt: g.last,
      linked: !!c.user_id, email: c.user_id ? (emails[c.user_id as string] ?? null) : null,
    }
  })

  return NextResponse.json({ clients: rows, year })
}
