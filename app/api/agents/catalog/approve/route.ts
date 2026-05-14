import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

function db() {
  return createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, reject } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const db_ = db()
  const { data: settings } = await db_
    .from('agent_settings').select('memory').eq('agent_key', 'catalog').single()
  const memory  = (settings?.memory ?? {}) as Record<string, unknown>
  const pending = (memory.pending_approvals ?? []) as any[]
  const item    = pending.find(p => p.id === id)

  if (!item) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const newPending = pending.filter(p => p.id !== id)

  if (!reject) {
    // Вставляем в таблицу
    const row: Record<string, unknown> = { name: item.name }
    if (item.category)   row.category   = item.category
    if (item.cost_price) row.cost_price = item.cost_price
    if (item.unit)       row.unit       = item.unit

    const { error } = await db_.from(item.table).insert(row)
    if (error && !error.message.includes('duplicate')) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await db_.from('agent_settings').update({
      memory: {
        ...memory,
        pending_approvals: newPending,
        approved_count: ((memory.approved_count as number) ?? 0) + 1,
      },
      updated_at: new Date().toISOString(),
    }).eq('agent_key', 'catalog')

    await db_.from('agent_logs').insert({
      agent_key: 'catalog', level: 'success', icon: '✅',
      message: `Добавлено в ${item.table}: ${item.name}`,
      ran_at: new Date().toISOString(),
    })

    return NextResponse.json({ ok: true, added: item.name })
  } else {
    await db_.from('agent_settings').update({
      memory: { ...memory, pending_approvals: newPending },
      updated_at: new Date().toISOString(),
    }).eq('agent_key', 'catalog')

    return NextResponse.json({ ok: true, rejected: item.name })
  }
}
