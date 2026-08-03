import { NextResponse } from 'next/server'
import { createClient as svc } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase-server'

// Read-only витрина финансов производства для цеха (санкция владельца на
// дублирование CFO-данных). Доступ: owner-роли или users.can_view_money.
// Данные считаются здесь и отдаются готовыми цифрами — страница ничего не пишет.

type VarRow = { name: string; pct: number }
type Income = { name: string; plan: number; vars: VarRow[] }
type FixedRow = { name: string; amount: number }
type Funds = { invest: number; training: number; reserve: number; prodBonus: number }
type Model = { incomes: Income[]; funds: Funds; ownerPct: number; ownerRub: number; fixed: FixedRow[] }

function db() {
  return svc(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export async function GET() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const service = db()
  const { data: profile } = await service.from('users')
    .select('role, can_view_money').eq('id', user.id).maybeSingle()
  const allowed = profile?.role === 'admin' || profile?.role === 'ceo' || profile?.role === 'cfo' || profile?.can_view_money === true
  if (!allowed) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  // Финмодель юнита «Производство» из CFO (finplan_models)
  const { data: fm } = await service.from('finplan_models').select('data').eq('unit', 'production').maybeSingle()
  const m = (fm?.data ?? null) as Model | null

  let model = null
  if (m) {
    const revenuePlan = m.incomes.reduce((s, i) => s + (i.plan || 0), 0)
    const margin = m.incomes.reduce((s, i) => {
      const varPct = i.vars.reduce((x, v) => x + (v.pct || 0), 0) / 100
      return s + (i.plan || 0) * (1 - varPct)
    }, 0)
    const marginPct = revenuePlan > 0 ? margin / revenuePlan : 0
    const fixed = m.fixed.reduce((s, f) => s + (f.amount || 0), 0)
    const f = m.funds
    // ТБ-лесенка (как хочет владелец): ТБ-0 в ноль → ТБ-1 +фонд бонусов цеха →
    // ТБ-2 +остальные фонды (инвестиции, обучение, резерв) → ТБ-цель +доход собственника
    // Цеху показываем только ТБ-0 и ТБ-1 (решение владельца) — уровни с фондами
    // развития и доходом собственника остаются в CFO и наружу не отдаются
    const be = (fundsPct: number) => {
      const denom = marginPct * (1 - fundsPct / 100)
      return denom > 0 ? Math.round(fixed / denom) : null
    }
    model = {
      revenuePlan,
      marginPct: Math.round(marginPct * 1000) / 10,
      fixed,
      funds: { prodBonus: f.prodBonus || 0 },
      fundsRub: { prodBonus: Math.round(margin * (f.prodBonus || 0) / 100) },
      tb0: be(0),
      tb1: be(f.prodBonus || 0),
    }
  }

  // Сборка помесячно с января 2026: заказы производства (без просчётов/истории/архива)
  const monthly: Record<string, { orders: number; amount: number }> = {}
  const monthlyCost: Record<string, number> = {}   // сумма себестоимости по месяцу (для реальной маржи, только админу)
  for (let from = 0; ; from += 1000) {
    const { data, error } = await service.from('b2b_orders')
      .select('created_at, total_after_discount, total_sale_inc_vat, total_cost_vat')
      .gte('created_at', '2026-01-01')
      .is('archived_at', null)
      .not('notes', 'ilike', '%"status":"quote"%')
      .not('notes', 'ilike', '%"historical":true%')
      .order('id')
      .range(from, from + 999)
    if (error) break
    for (const o of data ?? []) {
      const mKey = String(o.created_at).slice(0, 7)
      const cur = monthly[mKey] ?? { orders: 0, amount: 0 }
      cur.orders += 1
      cur.amount += o.total_after_discount ?? o.total_sale_inc_vat ?? 0
      monthly[mKey] = cur
      monthlyCost[mKey] = (monthlyCost[mKey] ?? 0) + (o.total_cost_vat ?? 0)
    }
    if (!data || data.length < 1000) break
  }

  // Реальная маржа по факту заказов месяца — приватная колонка ТОЛЬКО для admin.
  // Данные вычисляем и отдаём лишь ему; в браузер остальных ролей не уходят.
  const isAdmin = profile?.role === 'admin'
  let monthlyReal: Record<string, { cost: number; marginPct: number }> | undefined
  if (isAdmin) {
    monthlyReal = {}
    for (const k of Object.keys(monthly)) {
      const rev = monthly[k].amount
      const cost = monthlyCost[k] ?? 0
      monthlyReal[k] = { cost: Math.round(cost), marginPct: rev > 0 ? Math.round((1 - cost / rev) * 1000) / 10 : 0 }
    }
  }

  // Факт выручки текущего месяца — для прогресса к ТБ
  const nowKey = new Date().toISOString().slice(0, 7)
  const factThisMonth = monthly[nowKey] ?? { orders: 0, amount: 0 }

  // Участники бонусного фонда: производственники со стажем от 2 лет (users.hired_at)
  const { data: team } = await service.from('users')
    .select('name, email, hired_at')
    .eq('role', 'production').eq('active', true)
  const nowMs = Date.now()
  const bonusTeam = ((team ?? []) as { name: string | null; email: string | null; hired_at: string | null }[]).map(u => {
    const hired = u.hired_at ? new Date(u.hired_at) : null
    const years = hired ? (nowMs - hired.getTime()) / (365.25 * 86400000) : null
    return {
      name: u.name ?? u.email ?? '—',
      hiredAt: u.hired_at,
      years: years != null ? Math.round(years * 10) / 10 : null,
      eligible: years != null && years >= 2,
    }
  }).sort((a, b) => (b.years ?? -1) - (a.years ?? -1))

  return NextResponse.json({ model, monthly, monthlyReal, isAdmin, nowKey, factThisMonth, bonusTeam })
}
