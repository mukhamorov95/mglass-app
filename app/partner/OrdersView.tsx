'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'

// Общий вид списка заказов кабинета (тёмная премиальная тема). Один компонент под
// три пункта меню: view='all' (Табло + все), 'quotes' (просчёты), 'orders' (заказы).
// Никаких себестоимости/маржи — только цена клиента, прогресс, причина пересчёта.

type Lane = 'quote' | 'submitted' | 'in_work' | 'shipped'
type Order = {
  id: number; number: string; clientOrderNumber: string | null; created_at: string
  amount: number; lane: Lane; progressPct: number; stage: string
  shipped: boolean; ready: boolean; deadline: string; recalcNote: string | null
}
type Resp = { linked: boolean; client: { name: string } | null; orders: Order[] }
type Stats = { linked: boolean; year: number; ordersCount: number; sumYear: number; avgCheck: number; inWork: number; readyToShip: number; byMonth: number[] }

const fmtMoney = (n: number) => n > 0 ? Math.round(n).toLocaleString('ru-RU') + ' ₽' : '—'
const fmtDate = (s: string) => new Date(s).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })

const LANE_LABEL: Record<Lane, string> = {
  quote: 'Просчёты', submitted: 'Отправлены в работу', in_work: 'В работе', shipped: 'Отгружены',
}
const VIEW_LANES: Record<'all' | 'quotes' | 'orders', Lane[]> = {
  all: ['quote', 'submitted', 'in_work', 'shipped'],
  quotes: ['quote', 'submitted'],
  orders: ['in_work', 'shipped'],
}
const VIEW_META: Record<'all' | 'quotes' | 'orders', { title: string; sub: string; empty: string }> = {
  all: { title: 'Табло', sub: 'Сводка по вашим заказам', empty: 'Пока нет заказов' },
  quotes: { title: 'Мои просчёты', sub: 'Сохранённые расчёты и отправленные в работу', empty: 'Пока нет просчётов. Создайте новый в разделе «Калькулятор».' },
  orders: { title: 'Мои заказы', sub: 'Заказы в производстве и отгруженные', empty: 'Пока нет заказов в работе.' },
}
const MONTHS = ['Я', 'Ф', 'М', 'А', 'М', 'И', 'И', 'А', 'С', 'О', 'Н', 'Д']

function stagePill(o: Order) {
  if (o.lane === 'shipped')   return 'bg-[var(--p-surface2)] text-[var(--p-muted)] border-[var(--p-border)]'
  if (o.lane === 'quote')     return 'bg-[var(--p-surface2)] text-[var(--p-muted)] border-[var(--p-border)]'
  if (o.lane === 'submitted') return 'bg-[#2c2519] text-[#e0a45c] border-[#413621]'
  if (o.ready)                return 'bg-[#152a22] text-[#5fc79a] border-[#234034]'
  return 'bg-[#1a2133] text-[#7aa5f0] border-[#2a3757]'
}

export default function OrdersView({ view = 'all' }: { view?: 'all' | 'quotes' | 'orders' }) {
  const [data, setData] = useState<Resp | null>(null)
  const [loading, setLoading] = useState(true)
  const [showPwd, setShowPwd] = useState(false)
  const [pwd, setPwd] = useState('')
  const [pwd2, setPwd2] = useState('')
  const [pwdSaving, setPwdSaving] = useState(false)
  const [pwdMsg, setPwdMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [submittingId, setSubmittingId] = useState<number | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)

  function load() {
    return fetch('/api/partner/orders').then(r => r.json()).then((d: Resp) => setData(d)).catch(() => setData({ linked: false, client: null, orders: [] }))
  }
  useEffect(() => {
    load().finally(() => setLoading(false))
    if (view === 'all') fetch('/api/partner/stats').then(r => r.json()).then((s: Stats) => { if (s.linked) setStats(s) }).catch(() => {})
  }, [view])

  async function submitQuote(id: number) {
    setSubmittingId(id)
    try {
      const r = await fetch('/api/partner/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quoteId: id }) })
      if (r.ok) await load()
    } finally { setSubmittingId(null) }
  }

  async function changePassword() {
    setPwdMsg(null)
    if (pwd.length < 8) { setPwdMsg({ ok: false, text: 'Минимум 8 символов' }); return }
    if (pwd !== pwd2) { setPwdMsg({ ok: false, text: 'Пароли не совпадают' }); return }
    setPwdSaving(true)
    try {
      const { error } = await createClient().auth.updateUser({ password: pwd })
      if (error) { setPwdMsg({ ok: false, text: error.message }); return }
      setPwdMsg({ ok: true, text: 'Пароль изменён' })
      setPwd(''); setPwd2('')
      setTimeout(() => setShowPwd(false), 1200)
    } finally { setPwdSaving(false) }
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center text-[13px] text-[var(--p-muted)]">Загрузка…</div>

  const orders = data?.orders ?? []
  const lanes = VIEW_LANES[view]
  const visible = orders.filter(o => lanes.includes(o.lane))
  const meta = VIEW_META[view]
  const laneCount = (l: Lane) => orders.filter(o => o.lane === l).length

  return (
    <div className="min-h-screen pb-20">
      <div className="sticky top-0 z-10 bg-[var(--p-surface)]/90 backdrop-blur border-b border-[var(--p-border)] px-5 pt-12 pb-3.5 lg:pt-5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[21px] font-bold tracking-tight">{meta.title}</h1>
          <p className="text-[12.5px] text-[var(--p-muted)] mt-0.5 truncate">
            {data?.client?.name ? `${data.client.name} · ` : ''}{meta.sub}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <a href="/partner/new"
            className="text-[12px] px-3 py-1.5 rounded-[10px] bg-[var(--p-acc)] text-[var(--p-acc-ink)] font-semibold hover:opacity-90 transition-opacity">＋ Просчёт</a>
          <button onClick={() => { setShowPwd(true); setPwdMsg(null) }}
            className="text-[12px] px-3 py-1.5 rounded-[10px] border border-[var(--p-border)] text-[var(--p-ink2)] hover:border-[var(--p-ink)] hover:text-[var(--p-ink)] transition-colors">Пароль</button>
          <button onClick={async () => { await createClient().auth.signOut(); window.location.href = '/login' }}
            className="text-[12px] px-3 py-1.5 rounded-[10px] border border-[var(--p-border)] text-[var(--p-muted)] hover:text-[var(--p-ink)] transition-colors">Выйти</button>
        </div>
      </div>

      {showPwd && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setShowPwd(false)}>
          <div className="bg-[var(--p-surface)] border border-[var(--p-border)] rounded-2xl w-full max-w-sm shadow-2xl p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[15px] font-semibold">Смена пароля</h2>
              <button onClick={() => setShowPwd(false)} className="text-[var(--p-muted)] hover:text-[var(--p-ink)] text-lg leading-none">✕</button>
            </div>
            <p className="text-[12px] text-[var(--p-muted)] mb-3">Придумайте свой пароль — его будете знать только вы.</p>
            <input type="password" value={pwd} onChange={e => { setPwd(e.target.value); setPwdMsg(null) }}
              placeholder="Новый пароль (мин. 8 символов)" autoFocus
              className="w-full bg-[var(--p-surface2)] border border-[var(--p-border)] rounded-lg px-3 py-2 text-[13px] text-[var(--p-ink)] outline-none focus:border-[var(--p-acc)] mb-2" />
            <input type="password" value={pwd2} onChange={e => { setPwd2(e.target.value); setPwdMsg(null) }}
              placeholder="Повторите пароль"
              onKeyDown={e => { if (e.key === 'Enter') changePassword() }}
              className="w-full bg-[var(--p-surface2)] border border-[var(--p-border)] rounded-lg px-3 py-2 text-[13px] text-[var(--p-ink)] outline-none focus:border-[var(--p-acc)]" />
            {pwdMsg && <p className={`text-[12px] mt-2 ${pwdMsg.ok ? 'text-[#5fc79a]' : 'text-red-400'}`}>{pwdMsg.text}</p>}
            <button onClick={changePassword} disabled={pwdSaving}
              className="w-full mt-3 py-2.5 rounded-lg bg-[var(--p-acc)] text-[var(--p-acc-ink)] text-[13px] font-semibold hover:opacity-90 disabled:opacity-40 transition-opacity">
              {pwdSaving ? 'Сохраняю…' : 'Сохранить пароль'}
            </button>
          </div>
        </div>
      )}

      <div className="px-5 pt-4 space-y-3 max-w-[820px] mx-auto">
        {!data?.linked && (
          <div className="bg-[var(--p-surface)] rounded-2xl border border-[var(--p-border)] p-8 text-center">
            <p className="text-[14px] font-medium">Аккаунт ещё не привязан к вашей компании</p>
            <p className="text-[13px] text-[var(--p-muted)] mt-1">Обратитесь к вашему менеджеру M-Glass, чтобы открыть доступ к заказам.</p>
          </div>
        )}

        {/* ── Табло ── */}
        {view === 'all' && data?.linked && stats && (stats.ordersCount > 0 || stats.inWork > 0) && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { k: `Заказов за ${stats.year}`, v: String(stats.ordersCount) },
                { k: 'Сумма за год', v: fmtMoney(stats.sumYear) },
                { k: 'Средний чек', v: fmtMoney(stats.avgCheck) },
                { k: 'Сейчас в работе', v: `${stats.inWork}${stats.readyToShip ? ` · ${stats.readyToShip} готов${stats.readyToShip === 1 ? '' : 'ы'}` : ''}` },
              ].map(t => (
                <div key={t.k} className="bg-[var(--p-surface)] rounded-2xl border border-[var(--p-border)] px-4 py-3.5">
                  <p className="text-[11.5px] text-[var(--p-muted)] font-semibold">{t.k}</p>
                  <p className="text-[22px] font-bold tracking-tight mt-1.5 tabular-nums leading-tight">{t.v}</p>
                </div>
              ))}
            </div>

            <div className="grid lg:grid-cols-[1.55fr_1fr] gap-3">
              {stats.byMonth?.length === 12 && (
                <div className="bg-[var(--p-surface)] rounded-2xl border border-[var(--p-border)] p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-[13px] font-bold">Заказы по месяцам</h3>
                    <span className="text-[11.5px] text-[var(--p-muted)]">{stats.year} · шт.</span>
                  </div>
                  <MonthChart data={stats.byMonth} />
                </div>
              )}
              <div className="bg-[var(--p-surface)] rounded-2xl border border-[var(--p-border)] p-4">
                <h3 className="text-[13px] font-bold mb-1">Где ваши заказы</h3>
                <Breakdown rows={[
                  { nm: 'Просчёты', n: laneCount('quote'), c: '#8a8a85' },
                  { nm: 'Отправлены в работу', n: laneCount('submitted'), c: '#e0a45c' },
                  { nm: 'В работе', n: laneCount('in_work'), c: '#7aa5f0' },
                  { nm: 'Отгружено', n: laneCount('shipped'), c: '#5fc79a' },
                ]} />
              </div>
            </div>
          </>
        )}

        {data?.linked && visible.length === 0 && (
          <div className="bg-[var(--p-surface)] rounded-2xl border border-[var(--p-border)] p-8 text-center">
            <p className="text-[14px] text-[var(--p-muted)]">{meta.empty}</p>
          </div>
        )}

        {lanes.map(lane => {
          const list = visible.filter(o => o.lane === lane)
          if (list.length === 0) return null
          return (
            <div key={lane}>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-[var(--p-muted)] pt-2">{LANE_LABEL[lane]} · {list.length}</p>
              {list.map(o => <OrderCard key={o.id} o={o} onSubmit={submitQuote} submitting={submittingId === o.id} />)}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function MonthChart({ data }: { data: number[] }) {
  const max = Math.max(1, ...data)
  const peak = data.indexOf(Math.max(...data))
  return (
    <div className="grid grid-cols-12 gap-1.5 items-end h-[150px]">
      {data.map((v, i) => (
        <div key={i} className="flex flex-col items-center justify-end h-full gap-1.5" title={`${v} шт.`}>
          <div className="w-full max-w-[26px] rounded-t-md transition-all"
            style={{ height: `${v ? Math.max(4, Math.round(v / max * 100)) : 3}%`, background: i === peak ? '#7aa5f0' : 'linear-gradient(var(--p-acc), #7a2f26)' }} />
          <span className="text-[10px] text-[var(--p-muted)] font-semibold">{MONTHS[i]}</span>
        </div>
      ))}
    </div>
  )
}

function Breakdown({ rows }: { rows: { nm: string; n: number; c: string }[] }) {
  const max = Math.max(1, ...rows.map(r => r.n))
  return (
    <div className="space-y-2.5 mt-3">
      {rows.map(r => (
        <div key={r.nm} className="flex items-center gap-2.5">
          <span className="text-[12.5px] w-[130px] flex-shrink-0 text-[var(--p-ink2)]">{r.nm}</span>
          <span className="flex-1 h-2 bg-[var(--p-surface2)] rounded-full overflow-hidden">
            <span className="block h-full rounded-full" style={{ width: `${Math.round(r.n / max * 100)}%`, background: r.c }} />
          </span>
          <span className="text-[12px] text-[var(--p-muted)] font-semibold w-6 text-right tabular-nums">{r.n}</span>
        </div>
      ))}
    </div>
  )
}

function OrderCard({ o, onSubmit, submitting }: { o: Order; onSubmit: (id: number) => void; submitting: boolean }) {
  const clickable = o.lane !== 'quote'
  return (
    <div onClick={clickable ? () => { window.location.href = `/partner/order/${o.id}` } : undefined}
      className={`bg-[var(--p-surface)] rounded-2xl border border-[var(--p-border)] px-4 py-3 mt-2 ${clickable ? 'cursor-pointer hover:border-[var(--p-muted)] transition-colors' : ''}`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <p className="text-[14px] font-bold truncate">
            {o.number}
            {o.clientOrderNumber && <span className="text-[var(--p-muted)] font-normal"> · ваш № {o.clientOrderNumber}</span>}
          </p>
          <p className="text-[12px] text-[var(--p-muted)]">от {fmtDate(o.created_at)} · {fmtMoney(o.amount)}</p>
        </div>
        <span className={`text-[10px] font-medium px-2 py-1 rounded-full border whitespace-nowrap flex-shrink-0 ${stagePill(o)}`}>
          {o.stage}
        </span>
      </div>
      {(o.lane === 'in_work' || o.lane === 'shipped') && (
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 bg-[var(--p-surface2)] rounded-full overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${o.lane === 'shipped' ? 100 : o.progressPct}%`, background: o.ready ? '#5fc79a' : o.lane === 'shipped' ? '#4a4a44' : '#7aa5f0' }} />
          </div>
          {o.lane === 'in_work' && <span className="text-[11px] text-[var(--p-muted)] whitespace-nowrap">{o.progressPct}%</span>}
          {o.lane === 'in_work' && <span className="text-[11px] text-[var(--p-muted)] whitespace-nowrap">· срок {fmtDate(o.deadline)}</span>}
        </div>
      )}
      {o.recalcNote && (
        <div className="mt-2 text-[11px] text-[#e0a45c] bg-[#2c2519] border border-[#413621] rounded-lg px-2.5 py-1.5">
          ✎ Пересчитано менеджером: {o.recalcNote}
        </div>
      )}
      {o.lane === 'quote' && (
        <button onClick={() => onSubmit(o.id)} disabled={submitting}
          className="mt-2 w-full py-2 rounded-lg bg-[var(--p-acc)] text-[var(--p-acc-ink)] text-[12px] font-semibold hover:opacity-90 disabled:opacity-40 transition-opacity">
          {submitting ? 'Отправляю…' : 'Отправить в работу'}
        </button>
      )}
    </div>
  )
}
