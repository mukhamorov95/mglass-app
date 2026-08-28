'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

// Документы кабинета (дизайн .pcab): КП по каждому заказу/просчёту (скачивание PDF).
// Счёт-спецификацию выставляет компания — здесь только КП клиента (без себестоимости).

type Order = { id: number; number: string; created_at: string; amount: number; summary: string; positions: number; lane: string }
type Resp = { linked: boolean; orders: Order[] }

const fmtMoney = (n: number) => n > 0 ? Math.round(n).toLocaleString('ru-RU') + ' ₽' : '—'
const fmtDate = (s: string) => new Date(s).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: '2-digit' })

export default function PartnerDocumentsPage() {
  const [data, setData] = useState<Resp | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/partner/orders').then(r => r.json()).then((d: Resp) => setData(d)).catch(() => setData({ linked: false, orders: [] })).finally(() => setLoading(false))
  }, [])

  const orders = data?.orders ?? []

  return (
    <>
      <div className="top">
        <div>
          <h1>Документы</h1>
          <div className="cap">Коммерческие предложения по вашим заказам</div>
        </div>
        <Link className="primary" href="/partner/new">＋ Новый просчёт</Link>
      </div>

      <div className="wrap">
        <div className="info" style={{ marginBottom: 14 }}>
          <span>ℹ️</span>
          <span>КП можно скачать по каждому заказу. <b>Счёт-спецификацию</b> для оплаты выставляет и присылает ваш менеджер M-Glass после проверки просчёта.</span>
        </div>

        {loading && <div className="note"><div className="s">Загрузка…</div></div>}
        {!loading && !data?.linked && <div className="note"><div className="s">Аккаунт ещё не привязан к вашей компании.</div></div>}
        {!loading && data?.linked && orders.length === 0 && (
          <div className="note"><div className="s">Пока нет документов. Создайте просчёт в разделе «Калькулятор».</div></div>
        )}
        {!loading && data?.linked && orders.length > 0 && (
          <div className="card">
            {orders.map((o, i) => (
              <div className={`doc${i === 0 ? ' first' : ''}`} key={o.id}>
                <div className="fi">КП</div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="fn">КП {o.number} · {fmtMoney(o.amount)}</div>
                  <div className="fm">от {fmtDate(o.created_at)}{o.summary ? ` · ${o.summary}` : ''}{o.positions ? ` · ${o.positions} поз.` : ''}</div>
                </div>
                <Link className="dl" href={`/partner/order/${o.id}/kp`}>↓ Скачать</Link>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
