import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { getSessionUser } from '@/lib/getRole'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'

// Лента активности CRM (в духе amoCRM): хронология событий по всем лидам за
// период — звонки, сообщения, смены этапа, заметки, задачи, система. Владелец/
// CEO/РОП видят всё, менеджер — только свои лиды. Сортировка по id (=время).

async function whoAmI(): Promise<{ name: string; canAll: boolean } | null> {
  const user = await getSessionUser()
  if (!user) return null
  const sb = await createClient()
  const { data } = await sb.from('users').select('name,role,can_view_all_deals').eq('id', user.id).maybeSingle()
  const p = data as { name: string | null; role: string | null; can_view_all_deals: boolean | null } | null
  const name = p?.name ?? user.email ?? ''
  const canAll = ['admin', 'ceo', 'commercial'].includes(p?.role ?? '') || !!p?.can_view_all_deals
  return { name, canAll }
}

export async function GET(req: NextRequest) {
  const guard = await requireRole(['admin', 'ceo', 'commercial', 'manager'])
  if (guard instanceof NextResponse) return guard
  const me = await whoAmI()
  if (!me) return NextResponse.json({ error: 'no user' }, { status: 401 })

  const url = new URL(req.url)
  const days = Math.min(Math.max(Number(url.searchParams.get('days')) || 1, 1), 7)
  const kind = url.searchParams.get('kind')
  const since = new Date()
  since.setHours(0, 0, 0, 0)
  since.setDate(since.getDate() - (days - 1))

  const sb = createServiceClient()
  let query = sb.from('crm_lead_events')
    .select('id,lead_id,kind,text,author,created_at, crm_leads(name,phone,manager,stage,source)')
    .gte('created_at', since.toISOString())
    .order('id', { ascending: false })
    .limit(400)
  if (kind && kind !== 'all') query = query.eq('kind', kind)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  let rows = (data ?? []) as unknown as { crm_leads?: { manager: string | null } | null }[]
  // Изоляция: менеджер без «видит все» — только события своих лидов.
  if (!me.canAll) rows = rows.filter(r => r.crm_leads?.manager === me.name)
  return NextResponse.json({ events: rows, me: me.name, canAll: me.canAll })
}
