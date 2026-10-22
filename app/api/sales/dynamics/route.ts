import { NextRequest, NextResponse } from 'next/server'
import { requireAnyPageAccess } from '@/lib/apiAuth'
import { getSessionUser } from '@/lib/getRole'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { bookNames } from '@/lib/sales/bookNames'
import { pageAll } from '@/lib/supabase/pageAll'
import { mskDayKey } from '@/lib/time'
import {
  byMonth, moneyByMonth, totalsTo, sumTo, moneyCoveredTo, isClientIncome, isB2BSale,
  type Contour, type DatedAmount, type YearSeries,
} from '@/lib/sales/dynamics'

// Динамика продаж по месяцам — /sales/dynamics (M-Glass) и /b2b-crm/dynamics (B2B).
// M-Glass: владелец, CEO, коммерческий и менеджер с «видеть все сделки» — вся книга,
// остальные — свои продажи, как в «Продажах M-Glass». B2B — все заказы: список заказов
// контура и так открыт всем, кто туда входит. Деньги ДДС — только владельцу и CFO.

export const dynamic = 'force-dynamic'

const MONEY_ROLES = ['admin', 'ceo', 'cfo']
const FIRST_YEAR = 2025   // данные обоих контуров — с 2024, раньше сравнивать не с чем

const num = (v: unknown) => (typeof v === 'number' ? v : Number(v)) || 0

export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams
  const contour: Contour = sp.get('contour') === 'b2b' ? 'b2b' : 'mglass'
  const role = await requireAnyPageAccess([contour === 'b2b' ? '/b2b-crm' : '/sales'])
  if (role instanceof NextResponse) return role
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Нужно войти' }, { status: 401 })

  const today = mskDayKey()
  const curYear = Number(today.slice(0, 4))
  const year = Math.min(curYear, Math.max(FIRST_YEAR, Number(sp.get('year')) || curYear))
  const prev = year - 1
  const cutoff = year === curYear ? today.slice(5) : '12-31'
  const from = `${prev}-01-01`
  const toExcl = `${year + 1}-01-01`
  const sb = createServiceClient()

  let sales: DatedAmount[] = []
  let scope: 'all' | 'own' = 'all'
  try {
    if (contour === 'mglass') {
      const { data: p } = await (await createClient()).from('users').select('name,can_view_all_deals').eq('id', user.id).maybeSingle()
      const me = p as { name: string | null; can_view_all_deals: boolean | null } | null
      const canAll = ['admin', 'ceo', 'commercial'].includes(role) || !!me?.can_view_all_deals
      const names = bookNames(me?.name ?? user.email ?? '')
      if (!canAll) scope = 'own'
      if (canAll || names.length) {
        const rows = await pageAll<{ sale_date: string; amount: number }>((a, b) => {
          let q = sb.from('crm_sales').select('id,sale_date,amount')
            .eq('voided', false).neq('department', 'b2b')
            .gte('sale_date', from).lt('sale_date', toExcl).order('id')
          if (!canAll) q = q.in('manager', names)
          return q.range(a, b)
        })
        sales = rows.map(r => ({ date: r.sale_date, amount: num(r.amount) }))
      }
    } else {
      const rows = await pageAll<{ created_at: string; total_after_discount: number | null; total_sale_inc_vat: number | null; notes: unknown }>((a, b) =>
        sb.from('b2b_orders').select('id,created_at,total_after_discount,total_sale_inc_vat,notes')
          .is('archived_at', null)
          .gte('created_at', `${from}T00:00:00+03:00`).lt('created_at', `${toExcl}T00:00:00+03:00`)
          .order('id').range(a, b))
      sales = rows.filter(r => isB2BSale(r.notes))
        .map(r => ({ date: mskDayKey(r.created_at), amount: num(r.total_after_discount) || num(r.total_sale_inc_vat) }))
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }

  const canMoney = MONEY_ROLES.includes(role)
  let money: DatedAmount[] | null = null
  let coveredTo: string | null = null
  const unit = contour === 'b2b' ? 'ooo' : 'ip'
  if (canMoney) {
    try {
      const { data: funds, error: fErr } = await sb.from('cashflow_funds').select('id').eq('unit', unit).eq('flow', 'in')
      if (fErr) throw new Error(fErr.message)
      const fundIds = (funds ?? []).map(f => Number(f.id))
      const { data: subs, error: sErr } = fundIds.length
        ? await sb.from('cashflow_subfunds').select('id,name').in('fund_id', fundIds)
        : { data: [], error: null }
      if (sErr) throw new Error(sErr.message)
      const excluded = new Set((subs ?? []).filter(s => !isClientIncome(s.name as string)).map(s => Number(s.id)))
      const entries = fundIds.length ? await pageAll<{ entry_date: string; amount: number; subfund_id: number | null }>((a, b) =>
        sb.from('cashflow_entries').select('id,entry_date,amount,subfund_id')
          .eq('unit', unit).in('fund_id', fundIds)
          .gte('entry_date', from).lt('entry_date', toExcl)
          .order('id').range(a, b)) : []
      money = entries.filter(e => !excluded.has(Number(e.subfund_id))).map(e => ({ date: e.entry_date, amount: num(e.amount) }))
      const { data: last } = await sb.from('bank_statement_rows').select('op_date').eq('unit', unit)
        .order('op_date', { ascending: false }).limit(1).maybeSingle()
      coveredTo = moneyCoveredTo((last as { op_date?: string } | null)?.op_date ?? null)
    } catch (e) {
      return NextResponse.json({ error: `ДДС не прочитан: ${(e as Error).message}` }, { status: 500 })
    }
  }

  const series = (y: number): YearSeries => ({
    ...byMonth(sales, y),
    money: money && coveredTo ? moneyByMonth(money, y, coveredTo) : null,
  })
  // Деньги за год сравниваются по последний известный день — иначе месяцы без выписки
  // выглядели бы падением.
  const moneyCut = coveredTo && Number(coveredTo.slice(0, 4)) === year && coveredTo.slice(5) < cutoff ? coveredTo.slice(5) : cutoff

  return NextResponse.json({
    contour, year, prev, today, cutoff, scope, canMoney,
    series: { [year]: series(year), [prev]: series(prev) },
    totals: { cur: totalsTo(sales, year, cutoff), prev: totalsTo(sales, prev, cutoff) },
    money: money && coveredTo
      ? { unit, coveredTo, cutoff: moneyCut, cur: sumTo(money, year, moneyCut), prev: sumTo(money, prev, moneyCut) }
      : null,
  })
}
