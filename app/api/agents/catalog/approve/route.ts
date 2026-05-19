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

  const { id, idx, reject } = await req.json()

  const db_ = db()
  const { data: settings } = await db_
    .from('agent_settings').select('memory').eq('agent_key', 'catalog').single()
  const memory  = (settings?.memory ?? {}) as Record<string, unknown>
  const pending = (memory.pending_approvals ?? []) as any[]

  // Ищем по id или по индексу (для старых записей без id)
  let item: any = null
  let newPending: any[] = []

  if (id) {
    item       = pending.find(p => p.id === id)
    newPending = pending.filter(p => p.id !== id)
  } else if (typeof idx === 'number') {
    item       = pending[idx]
    newPending = pending.filter((_, i) => i !== idx)
  }

  if (!item) return NextResponse.json({ error: 'not found' }, { status: 404 })

  // Нормализуем — старый формат имел поле "suggestion" вместо "name"
  const name  = item.name ?? item.suggestion ?? '—'
  const table = item.table ?? 'materials'

  // Нормализуем категорию агента к значениям таблицы materials
  const CATEGORY_MAP: Record<string, string> = {
    'Стекло':          'стекло',
    'Фурнитура':       'фурнитура',
    'Комплектующие':   'расходники',
    'Химия':           'расходники',
    'Упаковка':        'расходники',
    'Профиль':         'профиль',
    'Подсветка':       'подсветка',
    'Электрика':       'электрика',
    'Работа':          'работа',
    'Услуга':          'услуга',
    'Прочее':          'расходники',
  }

  if (!reject) {
    const row: Record<string, unknown> = { name }
    if (table === 'materials') {
      const rawCat   = item.category ?? 'Прочее'
      row.category   = CATEGORY_MAP[rawCat] ?? rawCat.toLowerCase()
      row.unit       = item.unit       ?? 'шт'
      row.cost_price = item.cost_price ?? 0
    } else {
      row.unit       = item.unit       ?? 'шт'
      row.cost_price = item.cost_price ?? 0
    }

    const { error } = await db_.from(table).insert(row)
    if (error && !error.message?.includes('duplicate')) {
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
      message:   `Добавлено в ${table}: ${name}`,
      ran_at:    new Date().toISOString(),
    })

    return NextResponse.json({ ok: true, added: name })
  } else {
    await db_.from('agent_settings').update({
      memory: { ...memory, pending_approvals: newPending },
      updated_at: new Date().toISOString(),
    }).eq('agent_key', 'catalog')

    return NextResponse.json({ ok: true, rejected: name })
  }
}
