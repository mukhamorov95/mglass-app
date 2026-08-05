'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

// «Документы» (дизайн из прототипа, .pcab). Реальный источник — заказы клиента:
// на каждый оформленный заказ есть печатное КП (/partner/order/[id]/kp).
// Никакой себестоимости/маржи — только клиентские суммы.

type Lane = 'quote' | 'submitted' | 'in_work' | 'shipped'
type Order = { id: number; number: string; clientOrderNumber: string | null; created_at: string; amount: number; lane: Lane }
type Resp = { linked: boolean; orders: Order[] }

const fmtMoney = (n: number) => n > 0 ? Math.round(n).toLocaleString('ru-RU') + ' ₽' : '—'
const fmtDate = (s: string) => new Date(s).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })

export default function PartnerDocsPage() {
  const [data, setData] = useState<Resp | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/partner/orders').then(r => r.json()).then((d: Resp) => setData(d))
      .catch(() => setData({ linked: false, orders: [] })).finally(() => setLoading(false))
  }, [])

  // Документы формируются на оформленные заказы (отправлен в работу / в работе /
  // отгружен). Черновые просчёты живут в «Мои просчёты».
  const docs = (data?.orders ?? []).filter(o => o.lane !== 'quote')

  return (
    <>
      <div className="top">
        <div>
          <h1>Документы</h1>
          <div className="cap">КП по вашим заказам — формируются автоматически</div>
        </div>
        <Link className="ghost" href="/partner/orders">Мои заказы</Link>
      </div>

      <div className="wrap">
        {loading && <div className="note"><div className="s">Загрузка…</div></div>}

        {!loading && !data?.linked && (
          <div className="note">
            <div className="t">Аккаунт ещё не привязан к вашей компании</div>
            <div className="s">Обратитесь к вашему менеджеру M-Glass.</div>
          </div>
        )}

        {!loading && data?.linked && docs.length === 0 && (
          <div className="note"><div className="s">Документы появятся, когда заказ запустят в работу. Черновые просчёты — в разделе «Мои просчёты».</div></div>
        )}

        {!loading && docs.length > 0 && (
          <div className="card">
            <div className="card-h"><h3>Ваши документы</h3><span className="mut">КП формируется автоматически</span></div>
            {docs.map((o, i) => (
              <div className={`doc${i === 0 ? ' first' : ''}`} key={o.id}>
                <div className="fi">PDF</div>
                <div>
                  <div className="fn">Коммерческое предложение {o.number}</div>
                  <div className="fm">{fmtDate(o.created_at)} · {fmtMoney(o.amount)}{o.clientOrderNumber ? ` · ваш № ${o.clientOrderNumber}` : ''}</div>
                </div>
                <Link className="dl" href={`/partner/order/${o.id}/kp`}>Открыть</Link>
              </div>
            ))}
          </div>
        )}

        {!loading && data?.linked && (
          <div className="info" style={{ marginTop: 14 }}>
            Реквизиты вашей компании (ИНН, р/с, юр. адрес) хранятся у нас — счёт-спецификацию заполнит менеджер. Изменились реквизиты? Напишите менеджеру M-Glass.
          </div>
        )}
      </div>
    </>
  )
}
