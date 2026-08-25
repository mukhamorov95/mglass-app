import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'

// Б10: закрытие месяца ДДС. Закрыть может бухгалтерия, ОТКРЫТЬ обратно — только
// финансовый контур владельца: иначе «закрытие» не гарантия, а вежливая просьба.
// Сам запрет живёт в триггере БД (см. миграцию), здесь только управление замком
// и чтение журнала правок.

const FIN_ROLES = ['accountant', 'cfo', 'admin', 'ceo'] as const
const UNLOCK_ROLES = ['cfo', 'admin', 'ceo']

export async function GET(req: NextRequest) {
  const guard = await requireRole([...FIN_ROLES])
  if (guard instanceof NextResponse) return guard

  const url = new URL(req.url)
  const unit = url.searchParams.get('unit') === 'ooo' ? 'ooo' : 'ip'
  const month = url.searchParams.get('month') ?? ''

  const svc = createServiceClient()
  const [{ data: locks }, { data: log }] = await Promise.all([
    svc.from('cashflow_period_locks').select('*').eq('unit', unit).order('month', { ascending: false }).limit(24),
    /^\d{4}-\d{2}$/.test(month)
      ? svc.from('cashflow_entry_log').select('id,entry_id,action,entry_date,actor,at,before,after')
          .eq('unit', unit).gte('entry_date', `${month}-01`)
          .lt('entry_date', month.slice(0, 4) + '-' + String(Number(month.slice(5)) + 1).padStart(2, '0') + '-01')
          .order('at', { ascending: false }).limit(100)
      : Promise.resolve({ data: [] }),
  ])

  return NextResponse.json({
    locks: locks ?? [],
    locked: (locks ?? []).some(l => l.month === month),
    log: (log ?? []).map(l => ({
      id: Number(l.id), entry_id: Number(l.entry_id), action: l.action as string,
      entry_date: l.entry_date as string, actor: (l.actor as string) ?? null, at: l.at as string,
      amount: Number((l.after as { amount?: number } | null)?.amount ?? (l.before as { amount?: number } | null)?.amount ?? 0),
    })),
  })
}

export async function POST(req: NextRequest) {
  const guard = await requireRole([...FIN_ROLES])
  if (guard instanceof NextResponse) return guard
  const role = guard as string

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  const { data: me } = await sb.from('users').select('name').eq('id', user?.id ?? '').maybeSingle()
  const myName = (me as { name?: string } | null)?.name ?? user?.email ?? 'бухгалтерия'

  const body = await req.json().catch(() => ({}))
  const unit = body.unit === 'ooo' ? 'ooo' : 'ip'
  const month = String(body.month ?? '')
  const lock = body.action !== 'unlock'
  if (!/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: 'Нужен месяц' }, { status: 400 })

  const svc = createServiceClient()

  if (!lock) {
    if (!UNLOCK_ROLES.includes(role)) {
      return NextResponse.json({ error: 'Открыть закрытый месяц может только финансовый директор или владелец' }, { status: 403 })
    }
    const { error } = await svc.from('cashflow_period_locks').delete().eq('unit', unit).eq('month', month)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, locked: false })
  }

  const { error } = await svc.from('cashflow_period_locks').upsert({
    unit, month, locked_by: myName, locked_at: new Date().toISOString(),
    note: String(body.note ?? '').trim() || null,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, locked: true })
}
