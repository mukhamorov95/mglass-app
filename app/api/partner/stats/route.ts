import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { resolvePartnerClient } from '@/lib/partnerClient'

// Табло кабинета: сводка по заказам клиента за текущий год. Строго по своему
// client_id (b2b_clients.user_id = auth.uid()). Только клиентские суммы — никакой
// себестоимости/маржи.

function parseNotes(n: unknown): Record<string, unknown> {
  if (!n) return {}
  if (typeof n === 'object') return n as Record<string, unknown>
  try { const p = JSON.parse(String(n)); return typeof p === 'object' && p ? p as Record<string, unknown> : {} } catch { return {} }
}

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const svc = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const client = await resolvePartnerClient<{ id: number }>(svc, user.id)
  if (!client) return NextResponse.json({ linked: false })

  const { data } = await svc.from('b2b_orders')
    .select('created_at, launched_at, total_after_discount, total_sale_inc_vat, items, notes, archived_at')
    .eq('client_id', client.id).is('archived_at', null).limit(3000)

  const now = new Date()
  const year = now.getFullYear()
  let ordersCount = 0, sumYear = 0, inWork = 0, readyToShip = 0, savingsYear = 0
  const byMonth = Array(12).fill(0)
  const byMaterial = new Map<string, number>()   // A9: расходы по материалам за год

  for (const o of (data ?? []) as Record<string, unknown>[]) {
    const pn = parseNotes(o.notes)
    const stages = (pn.stages ?? {}) as Record<string, unknown>
    const launched = !!(o.launched_at || pn.launched_at)
    const shipped = stages.shipped === true
    const status = (pn.status as string) || 'quote'
    const lane = shipped ? 'shipped' : launched ? 'in_work' : status === 'pending_approval' ? 'submitted' : 'quote'
    const amount = Number(o.total_after_discount ?? o.total_sale_inc_vat ?? 0) || 0
    const created = new Date(o.created_at as string)

    // «Заказ» = запущен в производство (не просчёт и не ожидание согласования).
    if ((lane === 'in_work' || lane === 'shipped') && created.getFullYear() === year) {
      ordersCount++
      sumYear += amount
      byMonth[created.getMonth()] += amount

      // Экономия от договорной скидки (честно, из сохранённых сумм).
      const base = Number(o.total_sale_inc_vat ?? 0) || 0
      if (base > amount) savingsYear += base - amount

      // Расходы по материалам: итог заказа раскладываем пропорционально позициям.
      const items = Array.isArray(o.items) ? (o.items as Record<string, unknown>[]) : []
      const itemSale = items.map(it => Number(it.saleIncVat ?? 0) || 0)
      const itemsTotal = itemSale.reduce((s, v) => s + v, 0)
      if (itemsTotal > 0) {
        items.forEach((it, i) => {
          const name = String(it.materialName ?? '').trim() || 'Прочее'
          byMaterial.set(name, (byMaterial.get(name) ?? 0) + amount * (itemSale[i] / itemsTotal))
        })
      }
    }
    if (lane === 'in_work') {
      inWork++
      if (stages.packed === true) readyToShip++
    }
  }

  const topMaterials = [...byMaterial.entries()]
    .map(([name, amount]) => ({ name, amount: Math.round(amount) }))
    .sort((a, b) => b.amount - a.amount).slice(0, 5)

  return NextResponse.json({
    linked: true, year,
    ordersCount,
    sumYear: Math.round(sumYear),
    avgCheck: ordersCount ? Math.round(sumYear / ordersCount) : 0,
    inWork, readyToShip,
    savingsYear: Math.round(savingsYear),
    byMonth: byMonth.map(v => Math.round(v)),
    topMaterials,
  })
}
