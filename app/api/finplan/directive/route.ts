import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { FIN_ROLES } from '@/lib/accounting/roles'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { loadFundFree } from '@/lib/finplan/availability'
import { directiveShortages } from '@/lib/finplan/requests'

export const runtime = 'nodejs'

// ФП Ф4а: недельная директива. Совет решает по заявкам на экране «Комитет»;
// исп. директор (ceo, admin) утверждает план недели, CFO (cfo, admin) — окончательно.
// Окончательное утверждение резервирует деньги фондов и проходит только если
// одобренное по каждому фонду не больше свободного. Повтор не создаёт второй результат.

const DAY = /^\d{4}-\d{2}-\d{2}$/
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' })

async function myName() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  const { data } = await sb.from('users').select('name').eq('id', user?.id ?? '').maybeSingle()
  return (data as { name?: string } | null)?.name ?? user?.email ?? 'финконтур'
}

export async function GET(req: NextRequest) {
  const guard = await requireRole([...FIN_ROLES])
  if (guard instanceof NextResponse) return guard
  const sp = new URL(req.url).searchParams
  const unit = sp.get('unit') === 'ip' ? 'ip' : 'ooo'
  const week = sp.get('week_end') ?? ''
  if (!DAY.test(week)) return NextResponse.json({ error: 'week_end — среда ГГГГ-ММ-ДД' }, { status: 400 })
  const svc = createServiceClient()
  try {
    const [{ free }, d] = await Promise.all([
      loadFundFree(svc, unit, today(), week),
      svc.from('fp_directives').select('*').eq('unit', unit).eq('week_end', week).maybeSingle(),
    ])
    return NextResponse.json({ directive: d.data ?? { unit, week_end: week, status: 'open' }, free: [...free.values()] })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { unit?: string; week_end?: string; action?: string }
  const unit = body.unit === 'ip' ? 'ip' : 'ooo'
  const week = body.week_end ?? ''
  if (!DAY.test(week)) return NextResponse.json({ error: 'week_end — среда ГГГГ-ММ-ДД' }, { status: 400 })
  if (new Date(week + 'T00:00:00Z').getUTCDay() !== 3) return NextResponse.json({ error: 'week_end должен быть средой' }, { status: 400 })
  const action = body.action
  if (action !== 'exec' && action !== 'final') return NextResponse.json({ error: 'action: exec | final' }, { status: 400 })
  const guard = await requireRole(action === 'exec' ? ['ceo', 'admin'] : ['cfo', 'admin'])
  if (guard instanceof NextResponse) return guard

  const svc = createServiceClient()
  const name = await myName()
  const now = new Date().toISOString()
  const { data: cur, error: ce } = await svc.from('fp_directives').select('*').eq('unit', unit).eq('week_end', week).maybeSingle()
  if (ce) return NextResponse.json({ error: ce.message }, { status: 500 })
  if (cur?.status === 'final') return NextResponse.json({ ok: true, directive: cur, already: true })

  if (action === 'exec') {
    const { data, error } = await svc.from('fp_directives')
      .upsert({ unit, week_end: week, status: 'exec_ok', exec_by: name, exec_at: now }, { onConflict: 'unit,week_end' })
      .select('*').single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, directive: data })
  }

  if (cur?.status !== 'exec_ok') return NextResponse.json({ error: 'Сначала план недели утверждает исполнительный директор' }, { status: 409 })
  try {
    const { reqs, free } = await loadFundFree(svc, unit, today(), week)
    const approved = reqs.filter(q => q.week_end === week && q.status === 'approved')
      .map(q => ({ id: q.id, fund_id: q.fund_id, amount: Number(q.approved_amount ?? q.amount) }))
    const freeMap = new Map([...free.values()].map(f => [f.fund_id, f.free]))
    const short = directiveShortages(freeMap, approved)
    if (short.length) return NextResponse.json({ error: 'Одобрено больше, чем свободно в фондах', shortages: short }, { status: 409 })
    const { data, error } = await svc.from('fp_directives')
      .update({ status: 'final', final_by: name, final_at: now, snapshot: { approved, free: [...free.values()] } })
      .eq('unit', unit).eq('week_end', week).eq('status', 'exec_ok').select('*')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data?.length) {
      const { data: again } = await svc.from('fp_directives').select('*').eq('unit', unit).eq('week_end', week).maybeSingle()
      return NextResponse.json({ ok: again?.status === 'final', directive: again, already: true })
    }
    return NextResponse.json({ ok: true, directive: data[0] })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
