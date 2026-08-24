'use client'

import { useEffect, useState, use } from 'react'
import Link from 'next/link'

// Карточка заказа кабинета (дизайн из прототипа, .pcab).
type Item = { material: string; thickness: number; width: number; height: number; quantity: number; tempering: boolean; facet: boolean; triplex: boolean; price: number }
type TL = { label: string; state: 'done' | 'now' | 'wait'; date: string | null }
type Order = {
  id: number; number: string; clientOrderNumber: string | null; created_at: string
  lane: string; ready: boolean; progressPct: number; deadline: string | null
  total: number; items: Item[]; timeline: TL[]; drawingUrl: string | null; recalcNote: string | null
}

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₽'
const fmtDate = (s: string | null) => s ? new Date(s).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—'

const LANE_LABEL: Record<string, string> = { quote: 'Просчёт', submitted: 'Отправлен в работу', in_work: 'В работе', shipped: 'Отгружен' }

export default function PartnerOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [o, setO] = useState<Order | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    fetch(`/api/partner/order/${id}`).then(r => r.ok ? r.json() : Promise.reject())
      .then((d: Order) => setO(d)).catch(() => setNotFound(true)).finally(() => setLoading(false))
  }, [id])

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
          <div className="cap" style={{ marginTop: 3 }}>Создан {fmtDate(o.created_at)}{o.deadline ? ` · срок отгрузки ${fmtDate(o.deadline)}` : ''}</div>
        </div>
        <span className={`pill ${pillCls}`} style={{ fontSize: 12.5, padding: '6px 13px' }}>{statusText}</span>
      </div>

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
            <div className="card-h"><h3>Чертёж</h3></div>
            <div style={{ padding: 14 }}>
              {o.drawingUrl
                ? <a className="draw" href={o.drawingUrl} target="_blank" rel="noreferrer"><div style={{ fontSize: 26 }}>▤</div><div style={{ fontSize: 12.5, fontWeight: 600 }}>Чертёж заказа</div><div style={{ fontSize: 11.5 }}>нажмите, чтобы открыть PDF</div></a>
                : <div className="draw" style={{ cursor: 'default' }}><div style={{ fontSize: 26 }}>▤</div><div style={{ fontSize: 11.5 }}>чертёж появится после подготовки</div></div>}
            </div>
          </div>
        </div>
      </div>

      {(o.lane === 'in_work' || o.lane === 'shipped') && o.timeline.length > 0 && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="card-h"><h3>Ход производства</h3><span className="mut">{o.progressPct}% готово</span></div>
          <div className="timeline">
            {o.timeline.map((t, i) => (
              <div className={`tl${t.state === 'wait' ? ' pend' : ''}`} key={i}>
                <span className={`dot ${t.state}`} />
                <div><div className="ln">{t.label}</div><div className="dt">{t.state === 'now' ? 'сейчас' : t.date ? fmtDate(t.date) : 'ожидается'}</div></div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
        <Link className="ghost" href={`/partner/order/${o.id}/kp`}>↓ Скачать КП</Link>
        <Link className="primary" href={`/partner/new?reorder=${o.id}`}>Повторить заказ</Link>
      </div>
    </div>
  )
}
