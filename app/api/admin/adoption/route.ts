import { NextResponse } from 'next/server'
import { requireOwner } from '@/lib/apiAuth'
import { createServiceClient } from '@/lib/supabase-service'
import { classify, sortFlows, summarize, type FlowSpec, type FlowMeasure, type FlowRow } from '@/lib/b2b/adoptionAudit'

export const dynamic = 'force-dynamic'

// Аудит внедрения — только владельцу (admin/ceo). Считает использование флоу из
// боевых данных. Реестр флоу знает: где сигнал в данных, когда фича выкачена
// (дата PR), и меряется ли она вообще. Даты выката — из git-истории (PR merge),
// это метаданные, не выдумка: «слишком новая» честно отделяется от «мёртвой».

// mm — как посчитать использование флоу. Если measurable=false, счётчика нет.
type NotesPredicate = string   // SQL-выражение над jsonb-колонкой n (b2b_orders)
type FlowDef = FlowSpec & { notesExpr?: NotesPredicate; custom?: 'production_problem' | 'tg_managers' | 'client_prices' | 'mgr_plans' }

// ВНИМАНИЕ: даты shipped — из git origin/main (PR merge). Не трогать наугад.
const FLOWS: FlowDef[] = [
  // ── B2B менеджерский контур (мой домен) ──
  { key: 'adjust',      title: 'Ручная корректировка итога просчёта', domain: 'B2B',      shipped: '2026-08-25', measurable: true, notesExpr: "(n->'price_override') is not null", note: 'notes.price_override' },
  { key: 'kp_link',     title: 'Публичная ссылка на КП выдана',        domain: 'B2B',      shipped: '2026-08-25', measurable: true, notesExpr: "(n->'public_token') is not null" },
  { key: 'kp_opened',   title: 'Клиент открыл КП по ссылке',           domain: 'B2B',      shipped: '2026-08-25', measurable: true, notesExpr: "(n->'public_opened_at') is not null" },
  { key: 'kp_approve',  title: 'Клиент согласовал КП по ссылке',       domain: 'B2B',      shipped: '2026-08-25', measurable: true, notesExpr: "(n->'client_response'->>'action') = 'approve'" },
  { key: 'price_appr',  title: 'Согласование цены с тонкой маржой',    domain: 'B2B',      shipped: '2026-08-25', measurable: true, notesExpr: "(n->'price_approval') is not null" },
  { key: 'template',    title: 'Шаблон повторяющегося заказа',         domain: 'B2B',      shipped: '2026-08-25', measurable: true, notesExpr: "(n->>'is_template') = 'true'" },
  { key: 'repeat',      title: 'Повтор заказа',                        domain: 'B2B',      shipped: '2026-08-25', measurable: true, notesExpr: "(n->'repeated_from') is not null" },
  { key: 'claim',       title: 'Рекламация зафиксирована',            domain: 'B2B',      shipped: '2026-08-25', measurable: true, notesExpr: "(n->'claim') is not null" },
  { key: 'delivery',    title: 'Логистика отгрузки заполнена',         domain: 'B2B',      shipped: '2026-08-25', measurable: true, notesExpr: "(n->'delivery') is not null" },
  { key: 'client_price',title: 'Индивидуальный прайс клиента',         domain: 'B2B',      shipped: '2026-08-25', measurable: true, custom: 'client_prices' },
  { key: 'mgr_plan',    title: 'План/факт менеджера по B2B',           domain: 'B2B',      shipped: '2026-08-25', measurable: true, custom: 'mgr_plans' },
  { key: 'today',       title: '«Мой день» менеджера по B2B',          domain: 'B2B',      shipped: '2026-08-25', measurable: false, note: 'экран-чтение, открытий не логируем' },
  { key: 'deal_card',   title: 'Единая карточка сделки',              domain: 'B2B',      shipped: '2026-08-25', measurable: false, note: 'экран-чтение, открытий не логируем' },
  // ── Партнёрский кабинет (читаю, не правлю) ──
  { key: 'partner_req', title: 'Заявка от партнёра из кабинета',       domain: 'Партнёр',  shipped: '2026-08-25', measurable: true, notesExpr: "(n->'submitted_by_partner_at') is not null" },
  { key: 'drawing',     title: 'Согласование чертежа в кабинете',      domain: 'Партнёр',  shipped: '2026-08-25', measurable: true, notesExpr: "(n->'drawing_approval') is not null" },
  // ── Производство (читаю, не правлю) ──
  { key: 'defect',      title: 'Отметка брака / «Переделать»',         domain: 'Производство', shipped: '2026-06-30', measurable: true, custom: 'production_problem', note: 'контур задач живёт с 30.06 — отметка внутри него' },
]

const n = (v: unknown) => Number(v) || 0

export async function GET() {
  const guard = await requireOwner()
  if (guard instanceof NextResponse) return guard

  const svc = createServiceClient()

  // Один проход по b2b_orders для всех notes-флоу: три окна (всё/90/30).
  const notesFlows = FLOWS.filter(f => f.notesExpr)
  const measures = new Map<string, FlowMeasure>()

  // PostgREST не умеет count filter(where jsonb) — читаем notes и считаем в коде.
  // Флоу маленькие, тянем срез без истории 2024/2025.
  {
    const { data: orders } = await svc
      .from('b2b_orders')
      .select('notes, created_at')
      .is('archived_at', null)
      .limit(20000)
    const nowT = Date.now()
    const w90 = nowT - 90 * 86_400_000, w30 = nowT - 30 * 86_400_000
    const hit = (parsed: Record<string, unknown>, key: string): boolean => {
      switch (key) {
        case 'adjust':      return parsed.price_override != null
        case 'kp_link':     return parsed.public_token != null
        case 'kp_opened':   return parsed.public_opened_at != null
        case 'kp_approve':  return (parsed.client_response as { action?: string } | undefined)?.action === 'approve'
        case 'price_appr':  return parsed.price_approval != null
        case 'template':    return parsed.is_template === true
        case 'repeat':      return parsed.repeated_from != null
        case 'claim':       return parsed.claim != null
        case 'delivery':    return parsed.delivery != null
        case 'partner_req': return parsed.submitted_by_partner_at != null
        case 'drawing':     return parsed.drawing_approval != null
        default: return false
      }
    }
    const acc = new Map<string, { t: number; c90: number; c30: number }>()
    for (const f of notesFlows) acc.set(f.key, { t: 0, c90: 0, c30: 0 })
    for (const o of (orders ?? []) as { notes: string | null; created_at: string }[]) {
      const parsed = parseNotesSafe(o.notes)
      const ts = new Date(o.created_at).getTime()
      for (const f of notesFlows) {
        if (!hit(parsed, f.key)) continue
        const a = acc.get(f.key)!
        a.t++; if (ts >= w90) a.c90++; if (ts >= w30) a.c30++
      }
    }
    for (const f of notesFlows) {
      const a = acc.get(f.key)!
      measures.set(f.key, { usesTotal: a.t, uses90d: a.c90, uses30d: a.c30 })
    }
  }

  // Кастомные счётчики из отдельных таблиц.
  const [{ count: cp }, { count: mp }, defect, tg] = await Promise.all([
    svc.from('b2b_client_prices').select('id', { count: 'exact', head: true }),
    svc.from('b2b_manager_plans').select('id', { count: 'exact', head: true }),
    svc.from('production_tasks').select('status, updated_at').eq('status', 'problem').limit(5000),
    svc.from('telegram_users').select('user_id'),
  ])
  const now = Date.now()
  const d90 = now - 90 * 86_400_000, d30 = now - 30 * 86_400_000
  const defectRows = (defect.data ?? []) as { updated_at: string | null }[]
  const defect90 = defectRows.filter(r => r.updated_at && new Date(r.updated_at).getTime() >= d90).length
  const defect30 = defectRows.filter(r => r.updated_at && new Date(r.updated_at).getTime() >= d30).length

  // Менеджеры, привязанные к боту (предпосылка уведомлений).
  const tgUserIds = new Set(((tg.data ?? []) as { user_id: string | null }[]).map(t => t.user_id).filter(Boolean))
  const { data: managers } = await svc.from('users').select('id').eq('role', 'manager').eq('active', true)
  const boundManagers = ((managers ?? []) as { id: string }[]).filter(m => tgUserIds.has(m.id)).length

  measures.set('client_price', { usesTotal: n(cp), uses90d: n(cp), uses30d: n(cp) })
  measures.set('mgr_plan',     { usesTotal: n(mp), uses90d: n(mp), uses30d: n(mp) })
  measures.set('defect',       { usesTotal: defectRows.length, uses90d: defect90, uses30d: defect30 })

  const nowMs = Date.now()
  const rows: FlowRow[] = FLOWS.map(f => {
    const m = f.measurable
      ? (measures.get(f.key) ?? { usesTotal: 0, uses90d: 0, uses30d: 0 })
      : { usesTotal: null, uses90d: 0, uses30d: 0 }
    const r = classify(f, m, nowMs)
    // Гипотеза причины для мёртвого/затухающего — только где видна из данных.
    if (r.verdict === 'мертва') {
      if (f.key === 'defect') r.hint = 'контур задач активно используется, а брак не отмечают — нет привычки или входа на экране цеха'
    }
    return r
  })

  const sorted = sortFlows(rows)
  const totalManagers = (managers ?? []).length
  return NextResponse.json({
    generatedFor: 'owner',
    summary: summarize(sorted),
    flows: sorted,
    // Предпосылки — состояние настройки, а не usage-over-time. Отдельно, чтобы
    // «0 из 6 привязано» не пряталось за вердиктом «слишком новая» у самой фичи.
    preconditions: [
      {
        key: 'tg_binding',
        title: 'Менеджеры привязаны к Telegram-боту',
        value: `${boundManagers} из ${totalManagers}`,
        ok: totalManagers > 0 && boundManagers === totalManagers,
        note: 'Без привязки уведомления менеджеру (оплата, вопрос клиента, проблема на производстве) не доходят. Привязка: /admin/users → кнопка TG.',
      },
    ],
    note: 'Почти весь контур выкачен 25–26 августа: по нему adoption пока не измеряется — «слишком новая», а не «мертва».',
  }, { headers: { 'Cache-Control': 'no-store' } })
}

function parseNotesSafe(notes: string | null): Record<string, unknown> {
  if (!notes) return {}
  try { const p = JSON.parse(notes); return p && typeof p === 'object' ? p as Record<string, unknown> : {} } catch { return {} }
}
