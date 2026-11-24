import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { resolvePartnerMember } from '@/lib/partnerClient'
import { permsOf } from '@/lib/partner/teamRoles'
import { partnerProgress } from '@/lib/partner/orderProgress'
import { readPaged } from '@/lib/partner/readPaged'
import { SHOWER_GLASS } from '@/lib/production/clientShipments'

// Меню кабинета: имя, роль, права, счётчики и непрочитанные — одним лёгким запросом.
// Раньше меню звало полный /api/partner/orders (оплаты, УПД, отгрузки) ради трёх чисел.

function parseNotes(n: string | null): Record<string, unknown> {
  if (!n) return {}
  try { const p = JSON.parse(n); return typeof p === 'object' && p ? p as Record<string, unknown> : {} } catch { return {} }
}

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
  const svc = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const pm = await resolvePartnerMember<{ id: number; name: string; is_point: boolean | null }>(svc, user.id, 'id,name,is_point')
  if (!pm) return NextResponse.json({ linked: false })

  try {
    const [rows, unread] = await Promise.all([
      readPaged<{ launched_at: string | null; notes: string | null }>(() => svc.from('b2b_orders')
        .select('id,launched_at,notes').eq('client_id', pm.client.id).is('archived_at', null).order('id')),
      svc.from('partner_notifications').select('id', { count: 'exact', head: true }).eq('client_id', pm.client.id).is('read_at', null),
    ])
    const counts = { quotes: 0, inwork: 0, shipped: 0 }
    for (const r of rows) {
      const lane = partnerProgress({ launched_at: r.launched_at }, parseNotes(r.notes)).lane
      if (lane === 'quote') counts.quotes++
      else if (lane === 'shipped') counts.shipped++
      else counts.inwork++
    }
    return NextResponse.json({ linked: true, client: { name: pm.client.name }, isPoint: pm.client.is_point === true, shipTracking: pm.client.id === SHOWER_GLASS.clientId, role: pm.role, perms: permsOf(pm.role), counts, unread: unread.count ?? 0 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
