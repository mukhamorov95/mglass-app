'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-browser'
import { loadJson, responseError, NETWORK_ERROR } from '@/lib/toast'
import { POINT_LINE, type PointStage } from '@/lib/partner/pointPay'
import { QUOTE_LABEL, canEditQuote, canSubmitQuote, type QuoteState } from '@/lib/partner/quoteState'

// Списки кабинета (дизайн .pcab). Три пункта меню:
//   view='quotes'  → просчёты (черновики). Разбиты на Недавние + Архив (>2 недель).
//   view='inwork'  → заказы в работе (отправлены + в производстве)
//   view='shipped' → отгруженные заказы
// Табло — отдельный Dashboard. Только цена клиента, никакой себестоимости.

type Lane = 'quote' | 'submitted' | 'in_work' | 'shipped'
type Order = {
  id: number; number: string; clientOrderNumber: string | null; created_at: string; updatedAt: string
  amount: number; lane: Lane; progressPct: number; stage: string
  shipped: boolean; ready: boolean; deadline: string; recalcNote: string | null
  summary: string; positions: number
  point?: PointStage | null
  quoteState?: QuoteState | null
  stateNote?: string | null
}
type Resp = { linked: boolean; client: { name: string } | null; orders: Order[] }
type View = 'quotes' | 'inwork' | 'shipped'

const ARCHIVE_DAYS = 14
const fmtMoney = (n: number) => n > 0 ? Math.round(n).toLocaleString('ru-RU') + ' ₽' : '—'
const fmtDate = (s: string) => new Date(s).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: '2-digit' })
const ageDays = (s: string) => (Date.now() - new Date(s).getTime()) / 86400000

const LANE_LABEL: Record<Lane, string> = {
  quote: 'Просчёты', submitted: 'Отправлены в работу', in_work: 'В работе', shipped: 'Отгружены',
}
const VIEW_LANES: Record<View, Lane[]> = {
  quotes: ['quote'],
  inwork: ['submitted', 'in_work'],
  shipped: ['shipped'],
}
const VIEW_META: Record<View, { title: string; cap: string; empty: string }> = {
  quotes: { title: 'Мои просчёты', cap: 'Сохранённые расчёты — недавние и архив', empty: 'Пока нет просчётов. Создайте новый в разделе «Калькулятор».' },
  inwork: { title: 'Заказы в работе', cap: 'Отправленные и в производстве — с % готовности и сроком', empty: 'Пока нет заказов в работе.' },
  shipped: { title: 'Отгруженные заказы', cap: 'Завершённые заказы', empty: 'Пока нет отгруженных заказов.' },
}

export default function OrdersView({ view }: { view: View }) {
  const [data, setData] = useState<Resp | null>(null)
  const [loading, setLoading] = useState(true)
  const [showPwd, setShowPwd] = useState(false)
  const [pwd, setPwd] = useState('')
  const [pwd2, setPwd2] = useState('')
  const [pwdSaving, setPwdSaving] = useState(false)
  const [pwdMsg, setPwdMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [submittingId, setSubmittingId] = useState<number | null>(null)
  const [archiveOpen, setArchiveOpen] = useState(false)

  const [loadErr, setLoadErr] = useState<string | null>(null)

  async function load() {
    const r = await loadJson<Resp>('/api/partner/orders')
    if (r.error !== null) { setLoadErr(r.error); return }
    setLoadErr(null)
    setData(r.data)
  }
  useEffect(() => {
    let alive = true
    loadJson<Resp>('/api/partner/orders').then(r => {
      if (!alive) return
      if (r.error !== null) setLoadErr(r.error)
      else setData(r.data)
      setLoading(false)
    })
    return () => { alive = false }
  }, [])

  const [submitErr, setSubmitErr] = useState<{ id: number; text: string } | null>(null)
  async function submitQuote(id: number) {
    setSubmittingId(id); setSubmitErr(null)
    try {
      const r = await fetch('/api/partner/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quoteId: id }) })
      if (!r.ok) { setSubmitErr({ id, text: `Не отправлено: ${await responseError(r)}` }); return }
      await load()
    } catch {
      setSubmitErr({ id, text: `Не отправлено: ${NETWORK_ERROR}` })
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

  const meta = VIEW_META[view]
  const orders = data?.orders ?? []
  const lanes = VIEW_LANES[view]
  const visible = orders.filter(o => lanes.includes(o.lane))
  // Для просчётов: недавние (≤2 недель по последней активности) и архив.
  const recent = view === 'quotes' ? visible.filter(o => ageDays(o.updatedAt) <= ARCHIVE_DAYS) : visible
  const archived = view === 'quotes' ? visible.filter(o => ageDays(o.updatedAt) > ARCHIVE_DAYS) : []

  const card = (o: Order) => <OrderCard key={o.id} o={o} onSubmit={submitQuote} submitting={submittingId === o.id} submitErr={submitErr?.id === o.id ? submitErr.text : null} />
  const lanesOf = (list: Order[]) => lanes.map(lane => {
    const l = list.filter(o => o.lane === lane)
    if (l.length === 0) return null
    return (
      <div key={lane}>
        {view !== 'quotes' && <div className="lane-lbl">{LANE_LABEL[lane]} <span className="n">{l.length}</span></div>}
        {l.map(card)}
      </div>
    )
  })

  return (
    <>
      <div className="top">
        <div>
          <h1>{meta.title}</h1>
          <div className="cap">{data?.client?.name ? `${data.client.name} · ` : ''}{meta.cap}</div>
        </div>
        <div style={{ display: 'flex', gap: 9, alignItems: 'center' }}>
          <button className="ghost" onClick={() => { setShowPwd(true); setPwdMsg(null) }}>Сменить пароль</button>
          <Link className="primary" href="/partner/new">＋ Новый просчёт</Link>
        </div>
      </div>

      {showPwd && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={() => setShowPwd(false)}>
          <div className="card" style={{ width: '100%', maxWidth: 380, padding: 20 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Смена пароля</h3>
              <button className="out" onClick={() => setShowPwd(false)} style={{ background: 'none', border: 0, cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            <p className="cap" style={{ marginTop: 0, marginBottom: 12 }}>Придумайте свой пароль — его будете знать только вы.</p>
            <div className="fld" style={{ marginBottom: 8 }}>
              <input className="pinput" type="password" value={pwd} onChange={e => { setPwd(e.target.value); setPwdMsg(null) }} placeholder="Новый пароль (мин. 8 символов)" autoFocus />
            </div>
            <div className="fld">
              <input className="pinput" type="password" value={pwd2} onChange={e => { setPwd2(e.target.value); setPwdMsg(null) }} placeholder="Повторите пароль" onKeyDown={e => { if (e.key === 'Enter') changePassword() }} />
            </div>
            {pwdMsg && <p style={{ fontSize: 12, marginTop: 8, color: pwdMsg.ok ? 'var(--green)' : '#dc2626' }}>{pwdMsg.text}</p>}
            <button className="primary" onClick={changePassword} disabled={pwdSaving} style={{ width: '100%', marginTop: 14, padding: 11 }}>
              {pwdSaving ? 'Сохраняю…' : 'Сохранить пароль'}
            </button>
          </div>
        </div>
      )}

      <div className="wrap">
        <style dangerouslySetInnerHTML={{ __html: '.pcab .pinput{background:var(--surface-2);border:1px solid var(--border);border-radius:10px;padding:10px 12px;font-size:13.5px;color:var(--ink);font-family:inherit;outline:none;width:100%}.pcab .pinput:focus{border-color:var(--ink)}' }} />

        {loading && <div className="note"><div className="s">Загрузка…</div></div>}

        {!loading && loadErr && (
          <div className="note">
            <div className="t">Заказы не загрузились</div>
            <div className="s">{loadErr}. Обновите страницу через минуту.</div>
          </div>
        )}

        {!loading && !loadErr && data && !data.linked && (
          <div className="note">
            <div className="t">Аккаунт ещё не привязан к вашей компании</div>
            <div className="s">Обратитесь к вашему менеджеру M-Glass, чтобы открыть доступ к заказам.</div>
          </div>
        )}

        {!loading && data?.linked && visible.length === 0 && (
          <div className="note"><div className="s">{meta.empty}</div></div>
        )}

        {!loading && data?.linked && view === 'quotes' && recent.length > 0 && (
          <div>
            <div className="lane-lbl">Недавние <span className="n">{recent.length}</span></div>
            {recent.map(card)}
          </div>
        )}
        {!loading && data?.linked && view !== 'quotes' && lanesOf(recent)}

        {!loading && data?.linked && view === 'quotes' && archived.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <button className="lane-lbl" onClick={() => setArchiveOpen(v => !v)}
              style={{ background: 'none', border: 0, cursor: 'pointer', color: 'var(--muted)', padding: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ transform: archiveOpen ? '' : 'rotate(-90deg)', transition: '.15s' }}>▾</span>
              Архив · старше 2 недель <span className="n">{archived.length}</span>
            </button>
            {archiveOpen && (
              <>
                <div className="cap" style={{ margin: '4px 0 8px' }}>Откройте просчёт, чтобы восстановить — измените и сохраните, он вернётся в «Недавние».</div>
                {archived.map(card)}
              </>
            )}
          </div>
        )}
      </div>
    </>
  )
}

function OrderCard({ o, onSubmit, submitting, submitErr }: { o: Order; onSubmit: (id: number) => void; submitting: boolean; submitErr: string | null }) {
  // Черновик → клик открывает на редактирование. Согласованный, обсуждаемый, отклонённый
  // просчёт и заказ → карточка: править их нельзя, форма открылась бы пустой.
  const qs: QuoteState = o.quoteState ?? 'draft'
  const isDraft = o.lane === 'quote' && canEditQuote(qs)
  const body = (
    <>
      <div className="r1">
        <div>
          <div className="num">{o.number}{o.clientOrderNumber && <span className="yr"> · ваш № {o.clientOrderNumber}</span>}</div>
          <div className="meta">от {fmtDate(o.created_at)}{o.lane === 'in_work' ? ` · срок ${fmtDate(o.deadline)}` : o.point ? '' : o.lane === 'submitted' ? ' · ждём подтверждения менеджера' : ''}</div>
          {o.point && <div className="meta" style={{ marginTop: 2, color: o.point === 'await_payment' ? 'var(--amber)' : 'var(--ink-2)', fontWeight: o.point === 'await_payment' ? 600 : 400 }}>{POINT_LINE[o.point]}</div>}
          {o.summary && <div className="meta" style={{ marginTop: 2, color: 'var(--ink-2)' }}>{o.summary}{o.positions ? ` · ${o.positions} поз.` : ''}</div>}
        </div>
        <div className="amt tnum">{fmtMoney(o.amount)}</div>
      </div>

      {o.lane === 'quote' && qs !== 'draft' && (
        <div className="prog">
          <span className={`pill ${qs === 'rejected' ? 'p-ship' : qs === 'agreed' ? 'p-ready' : 'p-sub'}`}>{QUOTE_LABEL[qs]}</span>
        </div>
      )}
      {o.lane === 'quote' && qs !== 'draft' && o.stateNote && (
        <div className="meta" style={{ marginTop: 6 }}>{qs === 'rejected' ? 'Причина' : 'Комментарий менеджера'}: {o.stateNote}</div>
      )}

      {(o.lane === 'in_work' || o.lane === 'shipped') && (
        <div className="prog">
          <span className="track"><span className="tk" style={{ width: `${o.lane === 'shipped' ? 100 : o.progressPct}%`, background: o.ready ? 'var(--green)' : o.lane === 'shipped' ? 'var(--border)' : 'var(--blue)' }} /></span>
          {o.ready ? <span className="pill p-ready">Готов к выдаче</span>
            : o.lane === 'shipped' ? <span className="pill p-ship">Отгружен</span>
            : <span className="pc tnum">{o.progressPct}% · {o.stage}</span>}
        </div>
      )}

      {o.recalcNote && <div className="recalc">✎ Пересчитано менеджером: {o.recalcNote}</div>}

      {isDraft && canSubmitQuote(qs) && (
        <button className="send" onClick={e => { e.preventDefault(); onSubmit(o.id) }} disabled={submitting}>
          {submitting ? 'Отправляю…' : 'Отправить в работу'}
        </button>
      )}
      {submitErr && <div className="perr">{submitErr}</div>}
    </>
  )
  return (
    <Link href={isDraft ? `/partner/new?edit=${o.id}` : `/partner/order/${o.id}`} className="ord clk" style={{ display: 'block', textDecoration: 'none' }}>{body}</Link>
  )
}
