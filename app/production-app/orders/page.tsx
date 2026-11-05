'use client'

// Главное табло цеха «Заказы» (владелец 05.11.2026): вкладки как у Шовер Гласс, просроченные сверху, срез на любой период.
// Клик раскрывает заказ, даже уехавший: кто и когда поставил каждый этап. Отметка этапа идёт через PATCH /api/production-tasks,
// её может поставить ответственный (production_lead), владелец или мастер своей станции.

import { useEffect, useMemo, useState, useCallback, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import OrderLookup from '@/components/OrderLookup'
import { shopScopeOf, withShopScope } from '@/lib/production/shopScope'
import ShopScopeBanner from '@/components/production/ShopScopeBanner'
import ProductionTabs from '@/components/ProductionTabs'
import PointBadge from '@/components/PointBadge'
import { createClient } from '@/lib/supabase-browser'
import { STAGE_LABELS, type DetailStageKey } from '@/lib/productionStages'
import { ANDON_REASONS } from '@/lib/productionRouting'
import { materialLabelShort } from '@/lib/materialLabel'
import { daysWord } from '@/lib/b2b/inWorkOrders'
import { loadPointClientIds } from '@/lib/b2b/points'
import { ORDER_STATE_LABEL, numberMatches, type OrderShipState } from '@/lib/production/clientShipments'
import { BOARD_TABS, BOARD_TAB_KEYS, boardSort, inBoardTab, markLine, type BoardOrder, type BoardTab, type BoardTask } from '@/lib/production/ordersBoard'
import { loadJson, toast as errorToast, sendOrToast, responseError, NETWORK_ERROR } from '@/lib/toast'

type Item = { materialName?: string; category?: string; thickness?: number; width?: number; height?: number; quantity?: number; hasTempering?: boolean; hasFacet?: boolean; hasHoles?: boolean; shape?: 'rect' | 'curved'; hasTriplex?: boolean }
type Task = BoardTask & { id: number; station: string; rework_count: number | null; problem_reason_code: string | null; problem_comment: string | null; problem_at: string | null; problem_by_name: string | null }
type Detail = { id: number; items: Item[]; drawing_url: string | null; launched_at: string | null; tasks: Task[]; shipments: { day: string | null; pieces: number }[]; earlier_pieces: number }
type Me = { role: string | null; production_stations: string[] | null; production_lead: boolean }
type Period = { from: string; to: string }

const API = '/api/production/orders-board'
const OWNER = new Set(['admin', 'ceo'])
const OWNER_EMAIL = 'admin@mglass.ru'  // владелец опознаётся по email (см. lib/getRole)
const IDLE_ALARM_DAYS = 3
const STATE_CLS: Record<OrderShipState, string> = {
  none: 'bg-[#f5f5f3] text-[#4b4b47] border-[#e4e4e0]',
  partial: 'bg-amber-50 text-amber-700 border-amber-200',
  full: 'bg-emerald-50 text-emerald-700 border-emerald-200',
}
const stageLabel = (k: string) => STAGE_LABELS[k as DetailStageKey] ?? k
const fmtDay = (day: string | null | undefined) => (day ? `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}` : 'без даты')
const fmtStamp = (iso: string) => new Date(iso).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
function specLine(it?: Item): string {
  if (!it) return ''
  const dims = it.width && it.height ? `${it.width}×${it.height}` : ''
  const qty = it.quantity && it.quantity > 1 ? `${it.quantity} шт` : ''
  return [dims, materialLabelShort(it), qty].filter(Boolean).join(' · ')
}
const shift = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10)

export default function OrdersPage() {
  return <Suspense fallback={null}><OrdersScreen /></Suspense>
}

function OrdersScreen() {
  const params = useSearchParams()
  const scope = shopScopeOf(params.get('client'))
  const initialTab = params.get('tab')
  const [sb] = useState(() => createClient())
  const [orders, setOrders] = useState<BoardOrder[] | null>(null)
  const [today, setToday] = useState('')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [tab, setTabState] = useState<BoardTab>(BOARD_TAB_KEYS.includes(initialTab as BoardTab) ? initialTab as BoardTab : 'in_work')
  const [period, setPeriod] = useState<Period | null>(null)
  const [stageFilter, setStageFilter] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<number | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [points, setPoints] = useState<Set<number>>(new Set())
  const [me, setMe] = useState<Me>({ role: null, production_stations: [], production_lead: false })
  const [toast, setToast] = useState<string | null>(null)
  const [problemFor, setProblemFor] = useState<number | null>(null)
  const [pReason, setPReason] = useState(ANDON_REASONS[0].code)
  const [pComment, setPComment] = useState('')

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2800) }

  function setTab(next: BoardTab) {
    setTabState(next)
    setStageFilter(null)
    const q = new URLSearchParams(window.location.search)
    q.set('tab', next)
    window.history.replaceState(null, '', `${window.location.pathname}?${q}`)
  }

  const to = period?.to ?? null
  async function load() {
    const q = new URLSearchParams()
    if (scope) q.set('client', scope)
    if (to) q.set('to', to)
    const r = await loadJson<{ today: string; orders: BoardOrder[] }>(`${API}?${q}`)
    if (r.error !== null) { setLoadError(r.error); return }
    setLoadError(null)
    setToday(r.data.today)
    setOrders(r.data.orders)
  }
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { void load() }, [scope, to])

  async function loadDetail(id: number) {
    const r = await loadJson<Detail>(`${API}?id=${id}`)
    if (r.error !== null) { setDetailError(r.error); return }
    setDetailError(null)
    setDetail(r.data)
  }

  useEffect(() => {
    void (async () => {
      setPoints(await loadPointClientIds(sb))
      const { data: { user } } = await sb.auth.getUser()
      if (!user) return
      const { data: p } = await sb.from('users').select('role,production_stations').eq('id', user.id).single()
      let lead = false
      try { const { data: l } = await sb.from('users').select('production_lead').eq('id', user.id).maybeSingle(); lead = !!(l as { production_lead?: boolean } | null)?.production_lead } catch { /* колонка ещё не в кэше */ }
      setMe({ role: user.email === OWNER_EMAIL ? 'admin' : (p as Me | null)?.role ?? null, production_stations: (p as Me | null)?.production_stations ?? [], production_lead: lead })
    })()
  }, [sb])

  function toggle(id: number) {
    setProblemFor(null)
    if (open === id) { setOpen(null); return }
    setOpen(id)
    setDetail(null)
    setDetailError(null)
    void loadDetail(id)
  }

  const refreshOpen = async () => { await load(); if (open) await loadDetail(open) }
  const isLead = me.production_lead || (me.role != null && OWNER.has(me.role))
  const canMark = (station: string) => isLead || (me.production_stations ?? []).includes(station)

  async function markDone(taskId: number, station: string) {
    if (!canMark(station)) { flash('Этот этап отмечает мастер своей станции или ответственный'); return }
    const r = await fetch(`/api/production-tasks/${taskId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'done' }) })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) { flash(d.message || d.error || 'Не удалось отметить'); return }
    const n = Array.isArray(d.cascaded) ? d.cascaded.length : 0
    await refreshOpen()
    if (n > 0) flash(`Готово · предыдущие этапы закрыты автоматически (${n})`)
  }

  async function packAll(tasks: Task[]) {
    if (!isLead) { flash('«Упаковано разом» — только ответственный'); return }
    const rest = tasks.filter(t => t.status !== 'done')
    const errors: string[] = []
    for (const t of rest) {
      try {
        const r = await fetch(`/api/production-tasks/${t.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'done', force: true }) })
        if (!r.ok) errors.push(await responseError(r))
      } catch { errors.push(NETWORK_ERROR) }
    }
    await refreshOpen()
    // «Заказ отмечен готовым» — только если отметились все: иначе экран врал бы.
    if (errors.length) errorToast.error(`Не отмечено ${errors.length} из ${rest.length}`, { detail: [...new Set(errors)].join('; ') })
    else flash('Заказ отмечен готовым')
  }

  async function submitProblem(tasks: Task[]) {
    const frontier = tasks.filter(t => t.status !== 'done').sort((a, b) => a.sequence_order - b.sequence_order)[0]
    if (!frontier) { flash('Открытых этапов нет — проблему отметить не на чем'); return }
    const r = await sendOrToast('Проблема не записалась', `/api/production-tasks/${frontier.id}`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'problem', reason_code: pReason, comment: pComment || null }) },
      'Окно осталось открытым — попробуйте ещё раз')
    if (!r) return
    setProblemFor(null); setPComment(''); await refreshOpen(); flash('Проблема зафиксирована')
  }

  async function uploadDrawing(orderId: number, file: File) {
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
    const path = `order-drawings/${orderId}.${ext}`
    const { error } = await sb.storage.from('b2b-attachments').upload(path, file, { upsert: true })
    if (error) { flash('Не удалось загрузить'); return }
    // Точечный патч, а не перезапись notes целиком: блоб стирал бы то, что положили другие контуры.
    const { error: patchErr } = await sb.rpc('patch_order_notes_shallow', { p_order_id: orderId, p_patch: { drawing_url: path } })
    if (patchErr) { errorToast.error('Чертёж загружен, но к заказу не привязался', { detail: patchErr.message }); return }
    await loadDetail(orderId)
  }

  const all = useMemo(() => orders ?? [], [orders])
  const q = query.trim().toLowerCase()
  const matches = useCallback((o: BoardOrder) => !q || numberMatches(q, o.no, o.id) || o.client.toLowerCase().includes(q), [q])
  const isPoint = useCallback((o: BoardOrder) => o.client_id != null && points.has(o.client_id), [points])
  const tabCount = (t: BoardTab) => all.filter(o => inBoardTab(o, t, period)).length
  const inTab = useMemo(() => all.filter(o => inBoardTab(o, tab, period) && matches(o)), [all, tab, period, matches])
  const waiting = useMemo(() => {
    const m = new Map<string, number>()
    for (const o of inTab) for (const s of o.stages) if (s.done < s.total) m.set(s.key, (m.get(s.key) ?? 0) + 1)
    return [...m.entries()]
  }, [inTab])
  const visible = useMemo(() => boardSort(inTab.filter(o => !stageFilter || o.stages.some(s => s.key === stageFilter && s.done < s.total)), tab, isPoint), [inTab, stageFilter, tab, isPoint])
  const elsewhere = q && visible.length === 0 ? BOARD_TABS.filter(t => t.key !== tab && all.some(o => inBoardTab(o, t.key, period) && matches(o))) : []
  const activeTab = BOARD_TABS.find(t => t.key === tab)!
  const presets: { label: string; period: Period }[] = today ? [
    { label: 'Сегодня', period: { from: today, to: today } },
    { label: 'Неделя', period: { from: shift(today, -6), to: today } },
    { label: 'Этот месяц', period: { from: `${today.slice(0, 8)}01`, to: today } },
  ] : []
  const tabCls = (t: BoardTab, alarm = false) => `h-10 px-3 rounded-lg border text-[13px] font-medium ${tab === t
    ? 'bg-[#111110] text-white border-[#111110]'
    : alarm ? 'bg-red-50 text-red-700 border-red-200' : 'bg-white text-[#4b4b47] border-[#e4e4e0]'}`
  const chipCls = (on: boolean) => `h-8 px-2.5 rounded-lg border text-[12px] ${on ? 'bg-[#111110] text-white border-[#111110]' : 'bg-white text-[#4b4b47] border-[#e4e4e0]'}`

  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-20">
      {toast && <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-2.5 rounded-xl shadow-lg text-[13px] font-semibold bg-[#111110] text-white">{toast}</div>}
      <ProductionTabs />
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-4">
        <div>
          <h1 className="text-xl font-semibold text-[#111110]">📋 Заказы</h1>
          <p className="text-[13px] text-[#6b6b66] mt-1">Что просрочено, что на каком этапе и кто что отметил. Нажмите на заказ, чтобы раскрыть.{me.production_lead ? ' Вы ответственный.' : ''}</p>
          <ShopScopeBanner scope={scope} allHref="/production-app/orders" />
        </div>

        {loadError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
            Не удалось загрузить: {loadError}. <button onClick={() => void load()} className="underline font-medium">Обновить</button>
          </div>
        )}
        {!orders && !loadError && <p className="text-[13px] text-[#9a9a95]">Загружаю…</p>}

        {orders && (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              {BOARD_TABS.map(t => {
                const n = tabCount(t.key)
                return <button key={t.key} onClick={() => setTab(t.key)} aria-pressed={tab === t.key} className={tabCls(t.key, t.key === 'overdue' && n > 0)}>{t.label} · {n}</button>
              })}
              <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Номер или клиент"
                className="ml-auto h-10 w-40 rounded-lg border border-[#e4e4e0] bg-white px-2.5 text-[13px]" />
            </div>

            <div className="flex flex-wrap items-center gap-1.5 text-[13px] text-[#4b4b47]">
              <button onClick={() => setPeriod(null)} aria-pressed={!period} className={chipCls(!period)}>Сейчас</button>
              {presets.map(p => {
                const on = period?.from === p.period.from && period?.to === p.period.to
                return <button key={p.label} onClick={() => setPeriod(p.period)} aria-pressed={on} className={chipCls(on)}>{p.label}</button>
              })}
              <label className="flex items-center gap-1 ml-1">с <input type="date" value={period?.from ?? ''} max={period?.to ?? today} onChange={e => e.target.value && setPeriod({ from: e.target.value, to: period?.to && period.to >= e.target.value ? period.to : today })} className="h-8 rounded-lg border border-[#e4e4e0] bg-white px-1.5 text-[12px]" /></label>
              <label className="flex items-center gap-1">по <input type="date" value={period?.to ?? ''} min={period?.from} max={today} onChange={e => e.target.value && setPeriod({ from: period?.from && period.from <= e.target.value ? period.from : e.target.value, to: e.target.value })} className="h-8 rounded-lg border border-[#e4e4e0] bg-white px-1.5 text-[12px]" /></label>
            </div>
            {period && <p className="text-[12px] text-[#6b6b66]">Срез на конец дня {fmtDay(period.to)}: что было в работе, упаковано и просрочено на эту дату. «Отгружены» и «История» показывают отгрузки и запуски за {fmtDay(period.from)} — {fmtDay(period.to)}. Считается по отметкам: цех мог отметить этап позже, чем сделал.</p>}

            <p className="text-[12px] text-[#6b6b66]">{activeTab.hint}{tab === 'packed' && <> <Link href="/b2b-today/shipments" className="underline">Отметить старые отгрузки</Link></>}</p>

            {waiting.length > 0 && (tab === 'in_work' || tab === 'overdue') && (
              <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-[#6b6b66]">
                <span>Ждут этапа:</span>
                <button onClick={() => setStageFilter(null)} aria-pressed={!stageFilter} className={chipCls(!stageFilter)}>Все · {inTab.length}</button>
                {waiting.map(([key, n]) => <button key={key} onClick={() => setStageFilter(stageFilter === key ? null : key)} aria-pressed={stageFilter === key} className={chipCls(stageFilter === key)}>{stageLabel(key)} · {n}</button>)}
              </div>
            )}

            {visible.length === 0 && (
              <div className="text-[13px] text-[#9a9a95] space-y-1.5">
                <p>{q ? 'В этой вкладке такого заказа нет.' : activeTab.empty}</p>
                {elsewhere.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span>Есть во вкладке:</span>
                    {elsewhere.map(t => <button key={t.key} onClick={() => setTab(t.key)} className="underline text-[#111110]">{t.label}</button>)}
                  </div>
                )}
                {q && elsewhere.length === 0 && <OrderLookup query={query} linkBase="/production-app/orders" />}
              </div>
            )}

            <div className="space-y-1.5">
              {visible.map(o => (
                <OrderCard key={o.id} o={o} point={isPoint(o)} isOpen={open === o.id} onToggle={() => toggle(o.id)}>
                  {open === o.id && (
                    <OrderDetail o={o} detail={detail} error={detailError} scope={scope} canMark={canMark} isLead={isLead}
                      onRetry={() => void loadDetail(o.id)} onMark={markDone} onPackAll={packAll} onUpload={uploadDrawing}
                      problemOpen={problemFor === o.id} onProblemToggle={() => setProblemFor(problemFor === o.id ? null : o.id)}
                      pReason={pReason} setPReason={setPReason} pComment={pComment} setPComment={setPComment} onSubmitProblem={submitProblem} />
                  )}
                </OrderCard>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function OrderCard({ o, point, isOpen, onToggle, children }: { o: BoardOrder; point: boolean; isOpen: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div className={`bg-white rounded-lg border overflow-hidden ${o.problem || o.overdue_days > 0 ? 'border-red-200' : 'border-[#e4e4e0]'}`}>
      <button onClick={onToggle} aria-expanded={isOpen} className="w-full text-left px-3 py-2.5 hover:bg-[#fafaf9] space-y-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {o.urgent && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-600 text-white">🔥 СРОЧНО</span>}
          {point && <PointBadge />}
          <span className="text-[15px] font-semibold text-[#111110]">{o.no}</span>
          <span className="text-[13px] text-[#4b4b47]">{o.client}</span>
          <span className="text-[12px] text-[#9a9a95]">запуск {fmtDay(o.launch_day)} · срок {fmtDay(o.deadline_day)}</span>
          <span className={`text-[11px] px-1.5 py-0.5 rounded border ${STATE_CLS[o.state]}`}>{ORDER_STATE_LABEL[o.state]}{o.state === 'partial' ? ` · ${o.shipped_pieces} из ${o.pieces} шт.` : ''}{o.state === 'full' && o.ship_day ? ` ${fmtDay(o.ship_day)}` : ''}</span>
          {o.overdue_days > 0 && <span className="text-[11px] px-1.5 py-0.5 rounded border bg-red-50 text-red-700 border-red-200">Просрочен на {o.overdue_days} {daysWord(o.overdue_days)}</span>}
          {o.problem && <span className="text-[11px] px-1.5 py-0.5 rounded border bg-red-600 text-white border-red-600">Проблема</span>}
          {o.paid && <span className={`text-[11px] px-1.5 py-0.5 rounded border ${STATE_CLS.full}`}>Оплачен</span>}
          <span className="ml-auto text-[#9a9a95] text-[13px]">{isOpen ? '▲' : '▼'}</span>
        </div>
        <p className="text-[12px] text-[#6b6b66]">{o.positions} поз. · {o.pieces} шт. · {o.weight.toLocaleString('ru-RU')} кг{o.amount !== undefined ? ` · ${Math.round(o.amount).toLocaleString('ru-RU')} ₽` : ''}</p>
        {o.stages.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {o.stages.map(s => <span key={s.key} className={`text-[11px] px-1.5 py-0.5 rounded ${s.done === s.total ? 'bg-emerald-50 text-emerald-700' : s.done > 0 ? 'bg-amber-50 text-amber-700' : 'bg-[#f0f0ec] text-[#6b6b66]'}`}>{stageLabel(s.key)} {s.done}/{s.total}</span>)}
          </div>
        )}
        <p className="text-[12px] text-[#6b6b66]">
          {o.last_mark ? `Последняя отметка ${fmtStamp(o.last_mark.at)}${o.last_mark.by ? `, ${o.last_mark.by}` : ''}` : 'Отметок ещё нет'}
          {o.idle_days !== null && o.idle_days >= IDLE_ALARM_DAYS && <span className="text-amber-700"> · без отметок {o.idle_days} {daysWord(o.idle_days)}</span>}
        </p>
      </button>
      {isOpen && <div className="border-t border-[#f0f0ec] px-3 py-3 space-y-3">{children}</div>}
    </div>
  )
}

function OrderDetail({ o, detail, error, scope, canMark, isLead, onRetry, onMark, onPackAll, onUpload, problemOpen, onProblemToggle, pReason, setPReason, pComment, setPComment, onSubmitProblem }: {
  o: BoardOrder; detail: Detail | null; error: string | null; scope: ReturnType<typeof shopScopeOf>; canMark: (station: string) => boolean; isLead: boolean
  onRetry: () => void; onMark: (id: number, station: string) => void; onPackAll: (tasks: Task[]) => void; onUpload: (id: number, f: File) => void
  problemOpen: boolean; onProblemToggle: () => void; pReason: string; setPReason: (v: string) => void; pComment: string; setPComment: (v: string) => void; onSubmitProblem: (tasks: Task[]) => void
}) {
  if (error) return <p className="text-[13px] text-red-700">Не удалось загрузить заказ: {error}. <button onClick={onRetry} className="underline font-medium">Повторить</button></p>
  if (!detail || detail.id !== o.id) return <p className="text-[13px] text-[#9a9a95]">Загружаю этапы…</p>
  const live = o.stage !== 'shipped'
  const hasOpen = detail.tasks.some(t => t.status !== 'done')
  return (
    <>
      <div className="text-[12px] text-[#4b4b47] space-y-0.5">
        <p>Запущен: {detail.launched_at ? fmtStamp(detail.launched_at) : 'дата не записана'}. Срок: {fmtDay(o.deadline_day)}.</p>
        {o.state === 'full' && <p>Отгружен: {fmtDay(o.ship_day)}.</p>}
        {detail.earlier_pieces > 0 && <p>Уехало раньше, без даты: {detail.earlier_pieces} шт.</p>}
        {detail.shipments.map(s => <p key={s.day ?? 'x'}>Отгрузка {fmtDay(s.day)}: {s.pieces} шт.</p>)}
        <div className="flex flex-wrap gap-x-3 pt-0.5">
          {detail.drawing_url
            ? <a href={`/api/b2b/drawing/${o.id}`} target="_blank" rel="noreferrer" className="text-blue-600">📄 Открыть чертёж</a>
            : live && (
              <label className="text-[#6b6b66] cursor-pointer underline">📐 Прикрепить чертёж
                <input type="file" accept="image/*,application/pdf" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onUpload(o.id, f); e.target.value = '' }} />
              </label>
            )}
          <Link href={withShopScope(`/production-app/orders/${o.id}`, scope)} className="text-blue-600">Карточка заказа →</Link>
        </div>
      </div>

      <div className="space-y-2">
        {detail.items.map((it, i) => {
          const tasks = detail.tasks.filter(t => t.item_index === i)
          const open = tasks.filter(t => t.status !== 'done')
          // «Готово» = последний этап маршрута детали: закрывая его, API закроет и предыдущие.
          const final = open.length ? open.reduce((a, b) => (a.sequence_order > b.sequence_order ? a : b)) : null
          return (
            <div key={i} className="border border-[#f0f0ec] rounded-lg p-2.5 space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[12px] font-medium text-[#111110] min-w-0">Поз. {i + 1} · {specLine(it) || '—'}</p>
                {live && final && (
                  <button disabled={!canMark(final.station)} onClick={() => onMark(final.id, final.station)}
                    className={`shrink-0 text-[11px] font-semibold px-3 py-1.5 rounded-lg ${canMark(final.station) ? 'bg-emerald-600 text-white hover:opacity-90' : 'bg-[#f0f0ec] text-[#9a9a95] cursor-default'}`}>✓ Изделие готово</button>
                )}
              </div>
              {tasks.length === 0 && <p className="text-[12px] text-[#9a9a95]">Этапов нет.</p>}
              <div className="divide-y divide-[#f4f4f0]">
                {tasks.map(t => <StageRow key={t.id} t={t} live={live} canMark={canMark} onMark={onMark} />)}
              </div>
            </div>
          )
        })}
      </div>

      {live && hasOpen && (
        <div className="flex flex-wrap gap-2 pt-1">
          {isLead && <button onClick={() => onPackAll(detail.tasks)} className="flex-1 h-10 px-3 rounded-lg bg-[#111110] text-white text-[13px] font-semibold">📦 Упаковано — всё готово</button>}
          <button onClick={onProblemToggle} className="h-10 px-4 rounded-lg border border-red-200 text-red-600 text-[13px] font-semibold">Проблема</button>
        </div>
      )}
      {problemOpen && (
        <div className="border border-red-200 bg-red-50 rounded-lg p-3 space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {ANDON_REASONS.map(r => <button key={r.code} onClick={() => setPReason(r.code)} className={`text-[12px] px-2.5 py-1 rounded-full ${pReason === r.code ? 'bg-red-600 text-white' : 'bg-white border border-red-200 text-red-700'}`}>{r.label}</button>)}
          </div>
          <textarea value={pComment} onChange={e => setPComment(e.target.value)} rows={2} placeholder="Что случилось (необязательно)" className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#111110]" />
          <div className="flex gap-2">
            <button onClick={onProblemToggle} className="flex-1 h-10 rounded-lg border border-[#e4e4e0] text-[13px] text-[#6b6b66]">Отмена</button>
            <button onClick={() => onSubmitProblem(detail.tasks)} className="flex-1 h-10 rounded-lg bg-red-600 text-white text-[13px] font-semibold">Сообщить о проблеме</button>
          </div>
        </div>
      )}
    </>
  )
}

function StageRow({ t, live, canMark, onMark }: { t: Task; live: boolean; canMark: (station: string) => boolean; onMark: (id: number, station: string) => void }) {
  const done = t.status === 'done'
  const mark = done ? markLine(t, stageLabel) : null
  const allowed = live && !done && canMark(t.station)
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-1 text-[12px]">
      <span className={`w-24 shrink-0 font-medium ${done ? 'text-emerald-700' : t.status === 'problem' ? 'text-red-700' : 'text-[#6b6b66]'}`}>{done ? '✓ ' : ''}{stageLabel(t.stage_key)}</span>
      {done && t.completed_at && (
        <span className="text-[#4b4b47] min-w-0">
          {fmtStamp(t.completed_at)} · {mark?.by ?? <span className="text-[#9a9a95]">кто, не записано</span>}
          {mark?.note && <span className="text-[#9a9a95]"> · {mark.note}</span>}
        </span>
      )}
      {t.status === 'problem' && (
        <span className="text-red-700 min-w-0">
          Проблема{t.problem_reason_code ? `: ${ANDON_REASONS.find(r => r.code === t.problem_reason_code)?.label ?? t.problem_reason_code}` : ''}{t.problem_comment ? `, ${t.problem_comment}` : ''}{t.problem_at ? ` · ${fmtStamp(t.problem_at)}` : ''}{t.problem_by_name ? ` · ${t.problem_by_name}` : ''}
        </span>
      )}
      {!done && t.status !== 'problem' && <span className="text-[#9a9a95]">не отмечено</span>}
      {(t.rework_count ?? 0) > 0 && <span className="text-amber-700">переделка × {t.rework_count}</span>}
      {allowed && <button onClick={() => onMark(t.id, t.station)} className="ml-auto h-7 px-2.5 rounded-lg border border-[#e4e4e0] text-[11px] font-medium text-[#111110]">Отметить</button>}
    </div>
  )
}
