import { createClient } from '@/lib/supabase-server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getRole, isOwnerRole } from '@/lib/getRole'
import { type DetailStages, STAGE_LABELS } from '@/lib/productionStages'

// ─── Types ────────────────────────────────────────────────────────────────────

type AuditEntry = {
  type:              string
  item_index:        number
  stage_key:         string
  previous_value?:   { status?: string; updated_at?: string }
  reason?:           string
  created_at?:       string
  created_by?:       string
  created_by_email?: string
}

type AuditSummary = {
  count:  number
  latest: AuditEntry | null
}

type NotesData = {
  status?:             string
  launched_at?:        string
  production_days?:    number
  deadline_date?:      string
  stages?:             Partial<Record<string, string | null>>
  detail_stages?:      DetailStages
  detail_stage_audit?: AuditEntry[]
}

type Order = {
  id: number
  client_name: string
  custom_number: string | null
  client_order_number: string | null
  items: unknown[]
  notes: string | null
  created_at: string
  parsedNotes: NotesData
}

type DeadlineStatus = 'overdue' | 'today' | 'tomorrow' | 'normal' | 'ready' | 'shipped'

type ProblemEntry = {
  itemIndex: number
  reason?: string
  note?: string
}

type Filter = 'all' | 'overdue' | 'problems' | 'urgent' | 'ready' | 'audit'

// ─── Constants ────────────────────────────────────────────────────────────────

// STAGE_LABELS imported from lib/productionStages

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseNotes(notes: string | null): NotesData {
  if (!notes) return {}
  try {
    const p = JSON.parse(notes)
    if (typeof p === 'object' && p !== null) return p as NotesData
  } catch {}
  return {}
}

function fmtDateTime(s: string | undefined): string {
  if (!s) return '—'
  try {
    const d = new Date(s)
    if (isNaN(d.getTime())) return '—'
    return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  } catch {
    return '—'
  }
}

function getPlannedDeadline(pn: NotesData, createdAt: string): Date {
  if (pn.deadline_date) return new Date(pn.deadline_date)   // явный срок сдачи — приоритет
  if (pn.launched_at && pn.production_days) {
    const d = new Date(pn.launched_at)
    d.setDate(d.getDate() + pn.production_days)
    return d
  }
  if (pn.launched_at) {
    const d = new Date(pn.launched_at)
    d.setDate(d.getDate() + 7)
    return d
  }
  const d = new Date(createdAt)
  d.setDate(d.getDate() + 10)
  return d
}

function getDeadlineStatus(order: Order): {
  status: DeadlineStatus
  label: string
  daysDiff: number | null
} {
  const pn = order.parsedNotes
  const stages = pn.stages ?? {}
  if (stages.shipped)  return { status: 'shipped',  label: 'Отгружен', daysDiff: null }
  if (stages.packaged) return { status: 'ready',    label: 'Готов',    daysDiff: null }

  const planned = getPlannedDeadline(pn, order.created_at)
  const today   = new Date(); today.setHours(0, 0, 0, 0)
  const planDay = new Date(planned); planDay.setHours(0, 0, 0, 0)
  const daysDiff = Math.round((planDay.getTime() - today.getTime()) / 86_400_000)

  if (daysDiff < 0)   return { status: 'overdue',  label: `−${Math.abs(daysDiff)} дн.`, daysDiff }
  if (daysDiff === 0) return { status: 'today',    label: 'Сегодня',                    daysDiff }
  if (daysDiff === 1) return { status: 'tomorrow', label: 'Завтра',                     daysDiff }
  return { status: 'normal', label: `${daysDiff} дн.`, daysDiff }
}

function getProgress(order: Order): {
  done: number
  total: number
  hasProblems: boolean
  problems: ProblemEntry[]
} {
  const items  = Array.isArray(order.items) ? order.items : []
  const ds     = order.parsedNotes.detail_stages ?? {}
  const total  = items.length
  if (total === 0) return { done: 0, total: 0, hasProblems: false, problems: [] }

  let done = 0
  const problems: ProblemEntry[] = []

  for (let i = 0; i < total; i++) {
    const s = ds[String(i)]
    if (!s) continue
    if (s.packaging?.status === 'done')   done++
    if (s.problem?.status  === 'problem') {
      problems.push({ itemIndex: i, reason: s.problem.reason, note: s.problem.note })
    }
  }

  return { done, total, hasProblems: problems.length > 0, problems }
}

function getAuditSummary(order: Order): AuditSummary {
  const raw = order.parsedNotes.detail_stage_audit
  if (!Array.isArray(raw) || raw.length === 0) return { count: 0, latest: null }

  const entries = raw
    .filter(e => e?.type === 'stage_unset')
    .sort((a, b) => {
      const ta = a.created_at ? new Date(a.created_at).getTime() : 0
      const tb = b.created_at ? new Date(b.created_at).getTime() : 0
      return tb - ta
    })

  return { count: entries.length, latest: entries[0] ?? null }
}

const STATUS_ORDER: Record<DeadlineStatus, number> = {
  overdue: 0, today: 1, tomorrow: 2, normal: 3, ready: 4, shipped: 5,
}

const DEADLINE_BADGE: Record<DeadlineStatus, string> = {
  overdue:  'bg-red-50 text-red-600 border-red-200',
  today:    'bg-amber-50 text-amber-700 border-amber-200',
  tomorrow: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  normal:   'bg-line-soft text-ink-soft border-line',
  ready:    'bg-emerald-50 text-emerald-700 border-emerald-200',
  shipped:  'bg-line-soft text-muted border-line',
}

const FILTER_LABELS: Record<Filter, string> = {
  all:      'Все',
  overdue:  'Просрочено',
  problems: 'Проблемы',
  urgent:   'Сегодня / Завтра',
  ready:    'Упаковано',
  audit:    'С отменами',
}

const VALID_FILTERS: Filter[] = ['all', 'overdue', 'problems', 'urgent', 'ready', 'audit']

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function SupervisorPage(props: {
  searchParams: Promise<{ filter?: string }>
}) {
  const role = await getRole()
  if (!isOwnerRole(role)) redirect('/production-app')

  const sb = await createClient()
  const { data } = await sb
    .from('b2b_orders')
    .select('id,client_name,custom_number,client_order_number,items,notes,created_at')
    .not('notes', 'ilike', '%"status":"quote"%')
    .is('archived_at', null)
    .order('created_at', { ascending: false })
    .limit(500)

  const allOrders: Order[] = (data ?? []).map((o: Record<string, unknown>) => ({
    id:                  o.id as number,
    client_name:         o.client_name as string,
    custom_number:       o.custom_number as string | null,
    client_order_number: o.client_order_number as string | null,
    items:               Array.isArray(o.items) ? o.items : [],
    notes:               o.notes as string | null,
    created_at:          o.created_at as string,
    parsedNotes:         parseNotes(o.notes as string | null),
  }))

  const active = allOrders.filter(o => !o.parsedNotes.stages?.shipped)
  const dsMap  = new Map(active.map(o => [o.id, getDeadlineStatus(o)]))
  const pgMap  = new Map(active.map(o => [o.id, getProgress(o)]))
  const auMap  = new Map(active.map(o => [o.id, getAuditSummary(o)]))

  const counts = {
    tasks:    active.length,
    overdue:  active.filter(o => dsMap.get(o.id)?.status === 'overdue').length,
    problems: active.filter(o => pgMap.get(o.id)!.hasProblems).length,
    ready:    active.filter(o => {
      const p = pgMap.get(o.id)!
      return p.total > 0 && p.done === p.total
    }).length,
    audits:   active.filter(o => auMap.get(o.id)!.count > 0).length,
  }

  const sp     = await props.searchParams
  const filter: Filter = VALID_FILTERS.includes(sp.filter as Filter)
    ? (sp.filter as Filter)
    : 'all'

  const filtered = active.filter(o => {
    const ds = dsMap.get(o.id)!
    const pg = pgMap.get(o.id)!
    if (filter === 'overdue')  return ds.status === 'overdue'
    if (filter === 'problems') return pg.hasProblems
    if (filter === 'urgent')   return ds.status === 'today' || ds.status === 'tomorrow'
    if (filter === 'ready')    return ds.status === 'ready' || (pg.total > 0 && pg.done === pg.total)
    if (filter === 'audit')    return auMap.get(o.id)!.count > 0
    return true
  })

  const sorted = [...filtered].sort((a, b) => {
    const oa = STATUS_ORDER[dsMap.get(a.id)!.status]
    const ob = STATUS_ORDER[dsMap.get(b.id)!.status]
    if (oa !== ob) return oa - ob
    const pa = pgMap.get(a.id)!
    const pb = pgMap.get(b.id)!
    if (pa.hasProblems && !pb.hasProblems) return -1
    if (!pa.hasProblems && pb.hasProblems) return 1
    const da = dsMap.get(a.id)!.daysDiff ?? 999
    const db = dsMap.get(b.id)!.daysDiff ?? 999
    return da - db
  })

  return (
    <div className="min-h-screen bg-canvas pb-20">

      {/* Header */}
      <div className="bg-surface border-b border-line px-4 pt-12 pb-4 lg:pt-6">
        <Link href="/production-app" className="text-[12px] text-muted hover:text-ink mb-2 inline-block">
          ← Производство
        </Link>
        <h1 className="text-[20px] font-semibold text-ink tracking-tight">Панель производства</h1>
        <p className="text-[13px] text-muted mt-0.5">Обзор активных заказов</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 p-4">
        <StatCard label="Активных"   value={counts.tasks}    color="text-ink"   />
        <StatCard label="Просрочено" value={counts.overdue}  color="text-red-600"     />
        <StatCard label="Проблемы"   value={counts.problems} color="text-orange-600"  />
        <StatCard label="Упаковано"  value={counts.ready}    color="text-emerald-600" />
      </div>

      {/* Filter tabs */}
      <div className="px-4 pb-3">
        <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
          {VALID_FILTERS.map(f => (
            <Link
              key={f}
              href={f === 'all' ? '/production-app/supervisor' : `/production-app/supervisor?filter=${f}`}
              className={`whitespace-nowrap text-[11px] font-semibold px-3 py-1.5 rounded-full border transition-colors flex-shrink-0 ${
                filter === f
                  ? 'bg-ink text-white border-ink'
                  : 'bg-surface text-ink-soft border-line hover:border-ink hover:text-ink'
              }`}
            >
              {FILTER_LABELS[f]}
              {f === 'overdue'  && counts.overdue  > 0 && (
                <span className={`ml-1 ${filter === f ? 'text-red-300' : 'text-red-500'}`}>{counts.overdue}</span>
              )}
              {f === 'problems' && counts.problems > 0 && (
                <span className={`ml-1 ${filter === f ? 'text-orange-300' : 'text-orange-500'}`}>{counts.problems}</span>
              )}
              {f === 'audit' && counts.audits > 0 && (
                <span className={`ml-1 ${filter === f ? 'text-blue-300' : 'text-blue-500'}`}>{counts.audits}</span>
              )}
            </Link>
          ))}
        </div>
      </div>

      {/* Orders */}
      <div className="px-4">
        {sorted.length === 0 ? (
          <div className="bg-surface rounded-xl border border-line p-8 text-center">
            <p className="text-[14px] text-muted">Нет заказов</p>
          </div>
        ) : (
          <div className="space-y-3">
            {sorted.map(order => {
              const ds           = dsMap.get(order.id)!
              const prog         = pgMap.get(order.id)!
              const auditSummary = auMap.get(order.id)!
              const label        = order.custom_number?.trim() || `#${order.id}`
              const pct          = prog.total > 0 ? (prog.done / prog.total) * 100 : 0

              return (
                <div
                  key={order.id}
                  className={`bg-surface rounded-xl border px-4 py-3 ${
                    prog.hasProblems ? 'border-orange-200' : 'border-line'
                  }`}
                >
                  {/* Top row */}
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0">
                      <p className="text-[14px] font-semibold text-ink truncate">{label}</p>
                      <p className="text-[12px] text-ink-soft truncate">{order.client_name}</p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {prog.hasProblems && (
                        <span className="text-[11px] font-semibold px-2 py-1 rounded-full border bg-orange-50 text-orange-600 border-orange-200 tabular-nums">
                          ⚠ {prog.problems.length}
                        </span>
                      )}
                      {auditSummary.count > 0 && (
                        <span className="text-[11px] font-medium px-2 py-1 rounded-full border bg-blue-50 text-blue-600 border-blue-200 tabular-nums">
                          ↩ {auditSummary.count}
                        </span>
                      )}
                      <span className={`text-[11px] font-medium px-2 py-1 rounded-full border ${DEADLINE_BADGE[ds.status]}`}>
                        {ds.label}
                      </span>
                    </div>
                  </div>

                  {/* Progress bar */}
                  {prog.total > 0 && (
                    <div className="flex items-center gap-2 mb-2">
                      <div className="flex-1 h-1.5 bg-line-soft rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            prog.done === prog.total ? 'bg-emerald-500' : 'bg-ink'
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-[11px] text-muted whitespace-nowrap tabular-nums">
                        {prog.done}/{prog.total} уп.
                      </span>
                    </div>
                  )}

                  {/* Problem entries */}
                  {prog.problems.length > 0 && (
                    <div className="mb-2 space-y-0.5">
                      {prog.problems.map(p => (
                        <p key={p.itemIndex} className="text-[11px] text-orange-700 leading-snug">
                          ⚠ Поз.{p.itemIndex + 1}{p.reason ? ` — ${p.reason}` : ''}{p.note ? ` (${p.note})` : ''}
                        </p>
                      ))}
                    </div>
                  )}

                  {/* Audit indicator */}
                  {auditSummary.count > 0 && auditSummary.latest && (
                    <div className="mb-2 px-3 py-2 rounded-lg bg-canvas border border-line">
                      <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                        <span className="text-[11px] font-semibold text-ink-soft tabular-nums">
                          ↩ Отмены: {auditSummary.count}
                        </span>
                        <span className="text-[11px] text-faint">·</span>
                        <span className="text-[11px] text-muted tabular-nums">
                          {fmtDateTime(auditSummary.latest.created_at)}
                        </span>
                      </div>
                      <p className="text-[11px] text-ink-soft leading-snug">
                        Поз.{(auditSummary.latest.item_index ?? 0) + 1}
                        {' — '}{(STAGE_LABELS as Record<string, string>)[auditSummary.latest.stage_key] ?? auditSummary.latest.stage_key}
                        {auditSummary.latest.reason ? `: ${auditSummary.latest.reason}` : ''}
                      </p>
                      {auditSummary.latest.created_by_email && (
                        <p className="text-[11px] text-muted mt-0.5">
                          Кто: {auditSummary.latest.created_by_email}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Links */}
                  <div className="flex items-center gap-3 pt-1 border-t border-line-soft">
                    <Link
                      href={`/production-app/orders/${order.id}`}
                      className="text-[11px] font-semibold text-ink hover:underline"
                    >
                      → Заказ
                    </Link>
                    <span className="text-line text-[11px]">|</span>
                    <a
                      href={`/p/o/${order.id}`}
                      className="text-[11px] font-semibold text-blue-600 hover:underline"
                    >
                      → QR-экран
                    </a>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── StatCard ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-surface rounded-xl border border-line p-4">
      <p className="text-[11px] text-muted font-medium uppercase tracking-wide leading-tight">{label}</p>
      <p className={`text-[32px] font-semibold mt-1 leading-none tabular-nums ${color}`}>{value}</p>
    </div>
  )
}
