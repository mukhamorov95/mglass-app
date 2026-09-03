import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { requireDealActor } from '@/lib/b2c/dealScope'

export const dynamic = 'force-dynamic'

// Доска сделок — витрина уже построенного пути (шаги 1–4), не новая сущность.
// Этаж карточки ВЫЧИСЛЯЕТСЯ по реальному артефакту в сделке, а не проставляется
// руками (в этом всё отличие от АМО: доска не врёт, когда менеджер забыл перетащить).
// Скоуп и права — общий requireDealActor, как во всех /api/deals*; RLS — защита в глубину.
//
// Запросы пакетные: по одному .in('deal_id', ids) на каждую таблицу-артефакт,
// сведение по deal_id в коде. Не per-deal Promise.all — иначе 500 сделок = тысячи запросов.

const DEAL_COLS = 'id, client_name, phone, address, manager_id, amo_lead_id, created_by_name, created_at, updated_at'

// Этаж = самый дальний достигнутый артефакт. Порядок = путь денег до конца.
const STAGES = [
  { key: 'new',      label: 'Новая' },
  { key: 'quote',    label: 'Просчёт' },
  { key: 'kp',       label: 'КП отправлено' },
  { key: 'measure',  label: 'Замер' },
  { key: 'contract', label: 'Договор' },
  { key: 'pay',      label: 'Оплата' },
  { key: 'done',     label: 'Готово' },
] as const

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }

export async function GET() {
  const actor = await requireDealActor()
  if (actor instanceof NextResponse) return actor
  const svc = createServiceClient()

  let dq = svc.from('deals').select(DEAL_COLS).order('updated_at', { ascending: false }).limit(500)
  if (!actor.seeAll) dq = dq.or(`created_by.eq.${actor.userId},manager_id.eq.${actor.userId}`)
  const { data: dealsRaw, error } = await dq
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const deals = (dealsRaw ?? []) as Record<string, unknown>[]
  const ids = deals.map(d => Number(d.id))
  if (ids.length === 0) {
    return NextResponse.json({ stages: STAGES, cards: [], kpis: emptyKpis(), seeAll: actor.seeAll },
      { headers: { 'Cache-Control': 'no-store' } })
  }

  const [{ data: calcs }, { data: kps }, { data: contracts }, { data: measures }, { data: files }, { data: pays }] =
    await Promise.all([
      svc.from('calculations').select('deal_id, status, final_price').in('deal_id', ids),
      svc.from('commercial_proposals').select('deal_id, total, status, created_at').in('deal_id', ids),
      svc.from('contracts').select('deal_id, total, created_at').in('deal_id', ids),
      svc.from('measure_requests').select('deal_id, status, scheduled_at, created_at').in('deal_id', ids),
      svc.from('deal_files').select('deal_id, kind').in('deal_id', ids),
      svc.from('deal_payments').select('deal_id, amount, paid_at').in('deal_id', ids),
    ])

  // Сводим артефакты по deal_id.
  type Agg = {
    calcCount: number; calcMax: number; hasSentCalc: boolean
    kpCount: number; kpTotal: number
    contractCount: number; contractTotal: number
    measure: { status: string | null; scheduled_at: string | null } | null
    hasDrawing: boolean
    paid: number; payCount: number
  }
  const agg = new Map<number, Agg>()
  const get = (id: number) => {
    let a = agg.get(id)
    if (!a) { a = { calcCount: 0, calcMax: 0, hasSentCalc: false, kpCount: 0, kpTotal: 0, contractCount: 0, contractTotal: 0, measure: null, hasDrawing: false, paid: 0, payCount: 0 }; agg.set(id, a) }
    return a
  }
  for (const c of (calcs ?? []) as Record<string, unknown>[]) {
    const a = get(Number(c.deal_id)); a.calcCount++
    a.calcMax = Math.max(a.calcMax, num(c.final_price))
    if (c.status === 'sent' || c.status === 'approved') a.hasSentCalc = true
  }
  for (const k of (kps ?? []) as Record<string, unknown>[]) {
    const a = get(Number(k.deal_id)); a.kpCount++; a.kpTotal = num(k.total) || a.kpTotal
  }
  for (const c of (contracts ?? []) as Record<string, unknown>[]) {
    const a = get(Number(c.deal_id)); a.contractCount++; a.contractTotal = num(c.total) || a.contractTotal
  }
  for (const m of (measures ?? []) as Record<string, unknown>[]) {
    const a = get(Number(m.deal_id))
    if (!a.measure) a.measure = { status: (m.status as string) ?? null, scheduled_at: (m.scheduled_at as string) ?? null }
  }
  for (const f of (files ?? []) as Record<string, unknown>[]) {
    if (f.kind === 'drawing') get(Number(f.deal_id)).hasDrawing = true
  }
  for (const p of (pays ?? []) as Record<string, unknown>[]) {
    const a = get(Number(p.deal_id)); a.paid += num(p.amount); a.payCount++
  }

  const nowMs = Date.now()
  const monthPrefix = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' }).slice(0, 7) // YYYY-MM (МСК)
  const DAY = 86_400_000

  const cards = deals.map(d => {
    const id = Number(d.id)
    const a = agg.get(id)
    // Ценность сделки: договор → последнее КП → максимум по расчётам.
    const value = a ? (a.contractTotal || a.kpTotal || a.calcMax) : 0
    const paid = a?.paid ?? 0
    const remaining = Math.max(0, value - paid)

    // Этаж = самый дальний достигнутый артефакт.
    let key: string = 'new'
    if (a) {
      if (a.calcCount > 0) key = 'quote'
      if (a.kpCount > 0 || a.hasSentCalc) key = 'kp'
      if (a.measure) key = 'measure'
      if (a.contractCount > 0) key = 'contract'
      if (a.payCount > 0) key = 'pay'
      // Готово — деньги полностью получены (честный сигнал, а не ручная отметка).
      if (a.payCount > 0 && value > 0 && paid >= value - 1) key = 'done'
    }

    const ageDays = Math.floor((nowMs - new Date(String(d.updated_at)).getTime()) / DAY)
    return {
      id,
      client_name: (d.client_name as string) || '',
      address: (d.address as string) || '',
      phone: (d.phone as string) || '',
      amo_lead_id: (d.amo_lead_id as string) || null,
      manager_name: (d.created_by_name as string) || null,
      stage: key,
      value, paid, remaining,
      calcCount: a?.calcCount ?? 0,
      hasKp: (a?.kpCount ?? 0) > 0 || (a?.hasSentCalc ?? false),
      measure: a?.measure ?? null,
      hasContract: (a?.contractCount ?? 0) > 0,
      hasDrawing: a?.hasDrawing ?? false,
      ageDays,
    }
  })

  // KPI поверх карточек.
  const kpis = {
    inWork: cards.filter(c => c.stage !== 'done').length,
    awaitingPay: cards.filter(c => c.stage === 'contract' || c.stage === 'pay').reduce((s, c) => s + c.remaining, 0),
    stalled: cards.filter(c => c.stage !== 'done' && c.ageDays > 7).length,
    receivedThisMonth: (pays ?? []).reduce((s, p) => {
      const d = String((p as Record<string, unknown>).paid_at ?? '')
      return d.startsWith(monthPrefix) ? s + num((p as Record<string, unknown>).amount) : s
    }, 0),
  }

  return NextResponse.json({ stages: STAGES, cards, kpis, seeAll: actor.seeAll },
    { headers: { 'Cache-Control': 'no-store' } })
}

function emptyKpis() { return { inWork: 0, awaitingPay: 0, stalled: 0, receivedThisMonth: 0 } }
