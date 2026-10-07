'use client'

import { useEffect, useState, use } from 'react'
import Link from 'next/link'
import DrawingFiles from './DrawingFiles'
import type { PointStage } from '@/lib/partner/pointPay'
import { responseError, NETWORK_ERROR } from '@/lib/toast'

// Карточка заказа кабинета (дизайн из прототипа, .pcab).
type Item = { material: string; thickness: number; width: number; height: number; quantity: number; tempering: boolean; facet: boolean; triplex: boolean; price: number }
type TL = { label: string; state: 'done' | 'now' | 'wait'; date: string | null }
type Order = {
  id: number; number: string; clientOrderNumber: string | null; created_at: string
  lane: string; ready: boolean; progressPct: number; deadline: string | null; estimateDays?: number
  paymentStatus?: 'paid' | 'awaiting' | null
  onlinePayEnabled?: boolean
  canInvoice?: boolean
  point?: PointStage | null
  updIssued?: boolean
  upd?: { number: number; year: number; docDate: string } | null
  drawingApproval?: { status: 'approved' | 'rework'; comment: string | null; at: string | null } | null
  drawingPrev?: { status: 'approved' | 'rework'; at: string | null; updatedAt: string | null } | null
  launched?: boolean
  delivery?: { method: 'pickup' | 'delivery'; address: string | null; comment: string | null; status: string | null } | null
  total: number; items: Item[]; timeline: TL[]; drawingUrl: string | null; recalcNote: string | null
}

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₽'
const fmtDate = (s: string | null) => s ? new Date(s).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: '2-digit' }) : '—'

const LANE_LABEL: Record<string, string> = { quote: 'Просчёт', submitted: 'Отправлен в работу', in_work: 'В работе', shipped: 'Отгружен' }

export default function PartnerOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [o, setO] = useState<Order | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [reworkOpen, setReworkOpen] = useState(false)
  const [reworkText, setReworkText] = useState('')
  const [deciding, setDeciding] = useState(false)
  const [delivOpen, setDelivOpen] = useState(false)
  const [dMethod, setDMethod] = useState<'pickup' | 'delivery'>('delivery')
  const [dAddr, setDAddr] = useState('')
  const [dComment, setDComment] = useState('')
  const [dSaving, setDSaving] = useState(false)

  useEffect(() => {
    fetch(`/api/partner/order/${id}`).then(r => r.ok ? r.json() : Promise.reject())
      .then((d: Order) => setO(d)).catch(() => setNotFound(true)).finally(() => setLoading(false))
  }, [id])

  const [decideErr, setDecideErr] = useState<string | null>(null)
  async function decide(decision: 'approve' | 'rework', comment?: string) {
    setDeciding(true); setDecideErr(null)
    try {
      const r = await fetch(`/api/partner/order/${id}/approve-drawing`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, comment }),
      })
      if (!r.ok) { setDecideErr(`Решение не сохранено: ${await responseError(r)}`); return }
      const d = await r.json().catch(() => null) as { status?: { status: 'approved' | 'rework'; comment?: string | null; at?: string | null } } | null
      if (!d?.status) { setDecideErr('Решение не сохранено: сервер прислал пустой ответ. Обновите страницу'); return }
      const st = d.status
      setO(prev => prev ? { ...prev, drawingPrev: null, drawingApproval: { status: st.status, comment: st.comment ?? null, at: st.at ?? null } } : prev)
      setReworkOpen(false); setReworkText('')
    } catch {
      setDecideErr(`Решение не сохранено: ${NETWORK_ERROR}`)
    } finally { setDeciding(false) }
  }

  const [paying, setPaying] = useState(false)
  async function payOnline() {
    setPaying(true)
    try {
      const r = await fetch(`/api/partner/order/${id}/pay`, { method: 'POST' })
      const d = await r.json()
      if (r.ok && d.url) { window.location.href = d.url; return }
      alert(d.error || 'Оплата онлайн недоступна')
    } finally { setPaying(false) }
  }

  function openDelivery() {
    setDMethod(o?.delivery?.method ?? 'delivery')
    setDAddr(o?.delivery?.address ?? '')
    setDComment(o?.delivery?.comment ?? '')
    setDelivOpen(true)
  }
  async function saveDelivery() {
    setDSaving(true)
    try {
      const r = await fetch(`/api/partner/order/${id}/delivery`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: dMethod, address: dAddr, comment: dComment }),
      })
      const d = await r.json()
      if (r.ok && d.delivery) {
        setO(prev => prev ? { ...prev, delivery: { method: d.delivery.method, address: d.delivery.address ?? null, comment: d.delivery.comment ?? null, status: d.delivery.status ?? null } } : prev)
        setDelivOpen(false)
      }
    } finally { setDSaving(false) }
  }

  if (loading) return <div className="wrap"><div className="note"><div className="s">Загрузка…</div></div></div>
  if (notFound || !o) return (
    <div className="wrap"><div className="note">
      <div className="t">Заказ не найден</div>
      <Link href="/partner/orders" className="s" style={{ display: 'inline-block', marginTop: 10, color: 'var(--blue)' }}>← Мои заказы</Link>
    </div></div>
  )

  const pillCls = o.ready ? 'p-ready' : o.lane === 'shipped' ? 'p-ship' : o.lane === 'in_work' ? 'p-work' : 'p-quote'
  const statusText = o.ready ? 'Готов к выдаче' : LANE_LABEL[o.lane] ?? 'В работе'

  return (
    <div className="wrap">
      <Link href="/partner/orders" className="back">‹ Все заказы</Link>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-.02em' }}>
            {o.number}{o.clientOrderNumber && <span style={{ color: 'var(--muted)', fontWeight: 400 }}> · ваш № {o.clientOrderNumber}</span>}
          </div>
          <div className="cap" style={{ marginTop: 3 }}>Создан {fmtDate(o.created_at)}{o.deadline ? ` · срок отгрузки ${fmtDate(o.deadline)}` : (o.lane === 'submitted' && o.estimateDays ? ` · срок ~${o.estimateDays} раб. дней после запуска` : '')}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {o.paymentStatus && (
            <span style={{
              fontSize: 12.5, padding: '6px 13px', borderRadius: 999, fontWeight: 600,
              background: o.paymentStatus === 'paid' ? 'rgba(16,185,129,.12)' : 'rgba(245,158,11,.14)',
              color: o.paymentStatus === 'paid' ? '#0f766e' : '#b45309',
            }}>
              {o.paymentStatus === 'paid' ? '✓ Оплачен' : 'Ожидает оплаты'}
            </span>
          )}
          <span className={`pill ${pillCls}`} style={{ fontSize: 12.5, padding: '6px 13px' }}>{statusText}</span>
        </div>
      </div>

      {o.point && (
        <div className="info" style={{ marginTop: 0, marginBottom: 14 }}>
          <span>{o.point === 'paid' ? '✓' : '₽'}</span>
          <span>{o.point === 'check'
            ? <>Заказ уходит в работу после 100 % оплаты. Менеджер проверяет сумму — как только выставит счёт, он откроется здесь.</>
            : o.point === 'await_payment'
              ? <><b>Ждём вашей оплаты.</b> Заказ уйдёт в работу после 100 % оплаты — счёт-спецификация ниже.</>
              : <>Оплата получена — менеджер запускает заказ в работу.</>}</span>
        </div>
      )}

      {o.recalcNote && <div className="ord" style={{ boxShadow: 'none' }}><div className="recalc" style={{ marginTop: 0 }}>✎ Пересчитано менеджером: {o.recalcNote}</div></div>}

      <div className="split" style={{ marginTop: 0 }}>
        <div className="card">
          <div className="card-h"><h3>Позиции</h3><span className="mut">{o.items.length}</span></div>
          <div className="tbl-wrap"><table>
            <thead>
              <tr><th>Деталь</th><th>Размер, мм</th><th className="r">Кол-во</th><th className="r">Сумма</th></tr>
            </thead>
            <tbody>
              {o.items.map((it, i) => (
                <tr key={i}>
                  <td>{it.material} {it.thickness}мм{it.tempering ? ', закалка' : ''}{it.facet ? ', фацет' : ''}{it.triplex ? ', триплекс' : ''}</td>
                  <td className="tnum">{it.width} × {it.height}</td>
                  <td className="r tnum">{it.quantity}</td>
                  <td className="r tnum">{fmt(it.price)}</td>
                </tr>
              ))}
              <tr className="tot-row"><td colSpan={3}>Итого по вашей цене (с НДС)</td><td className="r tnum">{fmt(o.total)}</td></tr>
            </tbody>
          </table></div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="card" style={{ flex: 1 }}>
            <div className="card-h"><h3>Чертёж</h3>
              {o.drawingApproval?.status === 'approved' && <span className="pill p-ready" style={{ fontSize: 11 }}>Согласован</span>}
              {o.drawingApproval?.status === 'rework' && <span className="pill p-sub" style={{ fontSize: 11 }}>На доработке</span>}
            </div>
            <div style={{ padding: 14 }}>
              {o.drawingUrl
                ? <a className="draw" href={o.drawingUrl} target="_blank" rel="noreferrer"><div style={{ fontSize: 26 }}>▤</div><div style={{ fontSize: 12.5, fontWeight: 600 }}>Чертёж заказа</div><div style={{ fontSize: 11.5 }}>нажмите, чтобы открыть PDF</div></a>
                : <div className="draw" style={{ cursor: 'default' }}><div style={{ fontSize: 26 }}>▤</div><div style={{ fontSize: 11.5 }}>чертёж появится после подготовки</div></div>}

              {o.drawingUrl && o.drawingApproval?.status === 'approved' && (
                <div className="info" style={{ marginTop: 10 }}><span>✓</span><span>Вы согласовали чертёж{o.drawingApproval.at ? ` ${fmtDate(o.drawingApproval.at)}` : ''}. {o.launched ? 'Заказ в производстве.' : 'Менеджер запустит заказ в работу.'}</span></div>
              )}
              {o.drawingUrl && o.drawingApproval?.status === 'rework' && (
                <div className="recalc" style={{ marginTop: 10 }}>✎ Отправлено на доработку{o.drawingApproval.comment ? `: ${o.drawingApproval.comment}` : ''}. Менеджер пришлёт обновлённый чертёж.</div>
              )}
              {o.drawingUrl && !o.drawingApproval && o.drawingPrev && (
                <div className="info" style={{ marginTop: 10 }}><span>↻</span><span>Чертёж обновлён{o.drawingPrev.updatedAt ? ` ${fmtDate(o.drawingPrev.updatedAt)}` : ''} — после того как вы {o.drawingPrev.status === 'rework' ? 'отправили его на доработку' : 'его согласовали'}. Посмотрите новый и ответьте ещё раз.</span></div>
              )}
              {o.drawingUrl && !o.drawingApproval && !reworkOpen && (
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button className="primary" style={{ flex: 1 }} disabled={deciding} onClick={() => decide('approve')}>✓ Согласовать</button>
                  <button className="ghost" style={{ flex: 1 }} disabled={deciding} onClick={() => setReworkOpen(true)}>✎ На доработку</button>
                </div>
              )}
              {o.drawingUrl && !o.drawingApproval && reworkOpen && (
                <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <textarea className="pinput" rows={3} autoFocus value={reworkText} onChange={e => setReworkText(e.target.value)}
                    placeholder="Что поправить в чертеже?" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, padding: 10, fontSize: 13, color: 'var(--ink)', fontFamily: 'inherit', outline: 'none', resize: 'vertical' }} />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="primary" style={{ flex: 1 }} disabled={deciding || !reworkText.trim()} onClick={() => decide('rework', reworkText.trim())}>Отправить на доработку</button>
                    <button className="ghost" onClick={() => { setReworkOpen(false); setReworkText('') }}>Отмена</button>
                  </div>
                </div>
              )}
              {decideErr && <div className="perr">{decideErr}</div>}
            </div>
          </div>
          <DrawingFiles orderId={id} />
        </div>
      </div>

      {(o.lane === 'in_work' || o.lane === 'shipped') && o.timeline.length > 0 && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="card-h"><h3>Ход производства</h3><span className="mut">{o.progressPct}% готово</span></div>
          <div className="timeline">
            {o.timeline.map((t, i) => (
              <div className={`tl${t.state === 'wait' ? ' pend' : ''}`} key={i}>
                <span className={`dot ${t.state}`} />
                <div><div className="ln">{t.label}</div><div className="dt">{t.state === 'now' ? 'сейчас' : t.date ? fmtDate(t.date) : t.state === 'done' ? 'пройден' : 'ожидается'}</div></div>
              </div>
            ))}
          </div>
        </div>
      )}

      {o.lane !== 'quote' && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="card-h"><h3>Получение</h3>
            {o.delivery?.status && <span className="pill p-work" style={{ fontSize: 11 }}>{o.delivery.status}</span>}
          </div>
          <div style={{ padding: 14 }}>
            {!delivOpen && o.delivery && (
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{o.delivery.method === 'delivery' ? '🚚 Доставка' : '📦 Самовывоз'}</div>
                  {o.delivery.method === 'delivery' && o.delivery.address && <div className="cap" style={{ marginTop: 2 }}>{o.delivery.address}</div>}
                  {o.delivery.comment && <div className="cap" style={{ marginTop: 2 }}>{o.delivery.comment}</div>}
                </div>
                <button className="ghost" onClick={openDelivery}>Изменить</button>
              </div>
            )}
            {!delivOpen && !o.delivery && (
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                <div className="cap">Как удобнее получить заказ — доставка или самовывоз?</div>
                <button className="primary" onClick={openDelivery}>Указать</button>
              </div>
            )}
            {delivOpen && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div className="seg">
                  <button className={dMethod === 'delivery' ? 'on' : ''} onClick={() => setDMethod('delivery')}>🚚 Доставка</button>
                  <button className={dMethod === 'pickup' ? 'on' : ''} onClick={() => setDMethod('pickup')}>📦 Самовывоз</button>
                </div>
                {dMethod === 'delivery' && (
                  <input value={dAddr} onChange={e => setDAddr(e.target.value)} placeholder="Адрес доставки"
                    style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, padding: 10, fontSize: 13, color: 'var(--ink)', fontFamily: 'inherit', outline: 'none' }} />
                )}
                <input value={dComment} onChange={e => setDComment(e.target.value)} placeholder="Комментарий (необязательно)"
                  style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, padding: 10, fontSize: 13, color: 'var(--ink)', fontFamily: 'inherit', outline: 'none' }} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="primary" style={{ flex: 1 }} disabled={dSaving || (dMethod === 'delivery' && !dAddr.trim())} onClick={saveDelivery}>{dSaving ? 'Сохраняю…' : 'Сохранить'}</button>
                  <button className="ghost" onClick={() => setDelivOpen(false)}>Отмена</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
        {o.onlinePayEnabled && <button className="primary" onClick={payOnline} disabled={paying}>{paying ? 'Открываю оплату…' : '💳 Оплатить онлайн'}</button>}
        <Link className="ghost" href={`/partner/order/${o.id}/kp`}>↓ Скачать КП</Link>
        {o.canInvoice && <Link className="ghost" href={`/partner/order/${o.id}/invoice`}>↓ Счёт-спецификация</Link>}
        {o.upd && <Link className="ghost" href={`/partner/order/${o.id}/upd`}>↓ УПД № {o.upd.number} от {fmtDate(o.upd.docDate)}</Link>}
        {(o.lane === 'in_work' || o.lane === 'shipped') && <Link className="ghost" href={`/partner/claims?order=${o.id}`}>⚠️ Сообщить о проблеме</Link>}
        <Link className="primary" href={`/partner/new?reorder=${o.id}`}>Повторить заказ</Link>
      </div>
    </div>
  )
}
