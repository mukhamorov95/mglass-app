import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { requireDealActor } from '@/lib/b2c/dealScope'
import { DEAL_STAGES, dealStageKey, dealValue, type DealArtifacts } from '@/lib/b2c/dealProgress'

export const dynamic = 'force-dynamic'

// Доска сделок — витрина уже построенного пути (шаги 1–4), не новая сущность.
// Этаж карточки ВЫЧИСЛЯЕТСЯ по реальному артефакту в сделке, а не проставляется
// руками (в этом всё отличие от АМО: доска не врёт, когда менеджер забыл перетащить).
// Скоуп и права — общий requireDealActor, как во всех /api/deals*; RLS — защита в глубину.
//
// Запросы пакетные: по одному .in('deal_id', ids) на каждую таблицу-артефакт,
// сведение по deal_id в коде. Не per-deal Promise.all — иначе 500 сделок = тысячи запросов.

const DEAL_COLS = 'id, client_name, phone, address, manager_id, amo_lead_id, source, archived_at, lost_at, lost_reason, next_contact_at, created_by_name, created_at, updated_at'


const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const ms = (v: unknown) => { const t = new Date(String(v ?? '')).getTime(); return Number.isFinite(t) ? t : 0 }

export async function GET(req: NextRequest) {
  const actor = await requireDealActor()
  if (actor instanceof NextResponse) return actor
  const svc = createServiceClient()
  // ?archived=1 — вид архива. По умолчанию доска показывает только активные:
  // архив это «убрал с глаз», а не «удалил», и он не должен мешать работе.
  const archived = req.nextUrl.searchParams.get('archived') === '1'
  // Отказы уходят с доски своим видом: держать их в колонках — значит вечно
  // считать проигранное «в работе» и «зависшим».
  const lost = req.nextUrl.searchParams.get('lost') === '1'

  let dq = svc.from('deals').select(DEAL_COLS).order('updated_at', { ascending: false }).limit(500)
  dq = archived ? dq.not('archived_at', 'is', null) : dq.is('archived_at', null)
  dq = lost ? dq.not('lost_at', 'is', null) : dq.is('lost_at', null)
  if (!actor.seeAll) dq = dq.or(`created_by.eq.${actor.userId},manager_id.eq.${actor.userId}`)
  const { data: dealsRaw, error } = await dq
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const deals = (dealsRaw ?? []) as Record<string, unknown>[]
  const ids = deals.map(d => Number(d.id))
  if (ids.length === 0) {
    return NextResponse.json({ stages: DEAL_STAGES, cards: [], kpis: emptyKpis(), seeAll: actor.seeAll, archived, lost },
      { headers: { 'Cache-Control': 'no-store' } })
  }

  // Везде по возрастанию created_at: последняя строка = самая свежая, поэтому
  // «последнее КП / последний договор / последний замер» берётся простым
  // перезаписыванием, а не первой попавшейся строкой в произвольном порядке.
  const asc = { ascending: true } as const
  const [{ data: calcs }, { data: kps }, { data: contracts }, { data: measures }, { data: files }, { data: pays }] =
    await Promise.all([
      svc.from('calculations').select('deal_id, status, final_price, created_at').in('deal_id', ids).order('created_at', asc),
      svc.from('commercial_proposals').select('deal_id, total, status, created_at').in('deal_id', ids).order('created_at', asc),
      svc.from('contracts').select('deal_id, total, created_at').in('deal_id', ids).order('created_at', asc),
      svc.from('measure_requests').select('deal_id, status, scheduled_at, created_at').in('deal_id', ids).order('created_at', asc),
      svc.from('deal_files').select('deal_id, kind, created_at').in('deal_id', ids).order('created_at', asc),
      svc.from('deal_payments').select('deal_id, amount, paid_at, created_at').in('deal_id', ids).order('created_at', asc),
    ])

  // Сводим артефакты по deal_id.
  type Agg = {
    calcCount: number; calcMax: number; hasSentCalc: boolean
    kpCount: number; kpTotal: number
    contractCount: number; contractTotal: number
    measure: { status: string | null; scheduled_at: string | null } | null
    hasDrawing: boolean
    paid: number; payCount: number
    lastAt: number
  }
  const agg = new Map<number, Agg>()
  const get = (id: number) => {
    let a = agg.get(id)
    if (!a) { a = { calcCount: 0, calcMax: 0, hasSentCalc: false, kpCount: 0, kpTotal: 0, contractCount: 0, contractTotal: 0, measure: null, hasDrawing: false, paid: 0, payCount: 0, lastAt: 0 }; agg.set(id, a) }
    return a
  }
  // Последняя активность по сделке — максимум по артефактам: deals.updated_at не
  // двигается, когда приходят деньги, КП, договор или замер (они пишутся в свои
  // таблицы). По нему «зависшей» выглядела сделка, где вчера была предоплата.
  const touch = (a: Agg, v: unknown) => { const t = ms(v); if (t > a.lastAt) a.lastAt = t }

  for (const c of (calcs ?? []) as Record<string, unknown>[]) {
    const a = get(Number(c.deal_id)); a.calcCount++
    a.calcMax = Math.max(a.calcMax, num(c.final_price))
    if (c.status === 'sent' || c.status === 'approved') a.hasSentCalc = true
    touch(a, c.created_at)
  }
  for (const k of (kps ?? []) as Record<string, unknown>[]) {
    const a = get(Number(k.deal_id)); a.kpCount++; a.kpTotal = num(k.total); touch(a, k.created_at)
  }
  for (const c of (contracts ?? []) as Record<string, unknown>[]) {
    const a = get(Number(c.deal_id)); a.contractCount++; a.contractTotal = num(c.total); touch(a, c.created_at)
  }
  for (const m of (measures ?? []) as Record<string, unknown>[]) {
    const a = get(Number(m.deal_id))
    a.measure = { status: (m.status as string) ?? null, scheduled_at: (m.scheduled_at as string) ?? null }
    touch(a, m.created_at)
  }
  for (const f of (files ?? []) as Record<string, unknown>[]) {
    const a = get(Number(f.deal_id))
    if (f.kind === 'drawing') a.hasDrawing = true
    touch(a, f.created_at)
  }
  for (const p of (pays ?? []) as Record<string, unknown>[]) {
    const a = get(Number(p.deal_id)); a.paid += num(p.amount); a.payCount++
    touch(a, p.created_at); touch(a, p.paid_at)
  }

  const nowMs = Date.now()
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' })                    // YYYY-MM-DD (МСК)
  const monthPrefix = today.slice(0, 7)                                                                  // YYYY-MM
  const DAY = 86_400_000

  const cards = deals.map(d => {
    const id = Number(d.id)
    const a = agg.get(id)
    // Этаж и деньги — общей логикой с карточкой сделки (lib/b2c/dealProgress).
    const art: DealArtifacts = a ?? { calcCount: 0, calcMax: 0, hasSentCalc: false, kpCount: 0, kpTotal: 0, contractCount: 0, contractTotal: 0, paid: 0, payCount: 0 }
    const { value, paid, remaining } = dealValue(art)
    const key = dealStageKey(art)

    const lastAt = Math.max(ms(d.updated_at), a?.lastAt ?? 0) || nowMs
    const ageDays = Math.max(0, Math.floor((nowMs - lastAt) / DAY))
    return {
      id,
      client_name: (d.client_name as string) || '',
      address: (d.address as string) || '',
      phone: (d.phone as string) || '',
      amo_lead_id: (d.amo_lead_id as string) || null,
      manager_name: (d.created_by_name as string) || null,
      source: (d.source as string) || null,
      archived: !!d.archived_at,
      lost: !!d.lost_at,
      lostReason: (d.lost_reason as string) || null,
      nextContactAt: (d.next_contact_at as string) || null,
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
    // Просрочено обещание — сильнее «зависших»: менеджер сам назначил дату.
    overdue: cards.filter(c => c.stage !== 'done' && !!c.nextContactAt && c.nextContactAt <= today).length,
    receivedThisMonth: (pays ?? []).reduce((s, p) => {
      const d = String((p as Record<string, unknown>).paid_at ?? '')
      return d.startsWith(monthPrefix) ? s + num((p as Record<string, unknown>).amount) : s
    }, 0),
  }

  return NextResponse.json({ stages: DEAL_STAGES, cards, kpis, seeAll: actor.seeAll, archived, lost },
    { headers: { 'Cache-Control': 'no-store' } })
}

function emptyKpis() { return { inWork: 0, awaitingPay: 0, stalled: 0, overdue: 0, receivedThisMonth: 0 } }
