import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { notifyAdmins } from '@/lib/telegram'
import { mskDayKeyAgo } from '@/lib/time'
import { snapshotFor, type PlanRow } from '@/lib/finplanSnapshot'
import type { IncomeEntry } from '@/lib/finweek'

export const runtime = 'nodejs'

// ФП Ф2 (docs/finplan/FINPLAN_ROUTE.md): каждую ночь в 00:05 МСК — снимок
// периода, закрывшегося вчера (среда или последний день месяца), по каждому
// юниту с планом месяца. Повтор перезаписывает тот же период.
// ?day=2026-11-25 — догон за прошедший день; ?dry=1 — посчитать без записи.

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const sp = new URL(req.url).searchParams
  const dry = sp.get('dry') === '1'
  const day = sp.get('day') ?? mskDayKeyAgo(1)
  if (!DAY_RE.test(day) || day >= mskDayKeyAgo(0)) {
    return NextResponse.json({ error: 'day — прошедший день в формате ГГГГ-ММ-ДД' }, { status: 400 })
  }
  const month = day.slice(0, 7)
  const sb = createServiceClient()
  try {
    const [plans, subs] = await Promise.all([
      sb.from('cashflow_month_plans').select('unit,month,plan_amount,periods,approved_at').eq('month', month),
      sb.from('cashflow_subfunds').select('id').eq('non_income', true),
    ])
    if (plans.error) throw new Error('планы: ' + plans.error.message)
    if (subs.error) throw new Error('подфонды: ' + subs.error.message)
    const nonIncome = new Set((subs.data ?? []).map(s => s.id as number))
    const out = []
    for (const plan of (plans.data ?? []) as PlanRow[]) {
      const { data, error } = await sb.from('cashflow_entries').select('entry_date,kind,subfund_id,amount')
        .eq('unit', plan.unit).eq('kind', 'in').gte('entry_date', month + '-01').lte('entry_date', day).range(0, 9999)
      if (error) throw new Error(`операции ${plan.unit}: ${error.message}`)
      const snap = snapshotFor(plan, day, (data ?? []) as IncomeEntry[], nonIncome)
      if (!snap) continue
      if (!dry) {
        const { error: e2 } = await sb.from('cashflow_period_snapshots')
          .upsert({ ...snap, taken_at: new Date().toISOString() }, { onConflict: 'unit,period_end' })
        if (e2) throw new Error(`запись ${plan.unit}: ${e2.message}`)
      }
      out.push(snap)
    }
    return NextResponse.json({ ok: true, dry, day, snapshots: out })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (!dry) await notifyAdmins(`📅 <b>Снимок среды (финпланирование)</b>\nНе записан за ${day}: ${msg}`).catch(() => {})
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
