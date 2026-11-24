'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { loadJson } from '@/lib/toast'
import { INVOICE_HINT, type InvoiceState, type UpdShort } from '@/lib/partner/documents'

// Документы кабинета (дизайн .pcab): по каждому заказу одной строкой КП · счёт · УПД.
// Счёт — если он открыт этому партнёру; УПД — только выданный бухгалтерией.

type Order = {
  id: number; number: string; created_at: string; amount: number; summary: string; positions: number; lane: string
  invoice: InvoiceState; upd: UpdShort | null
}
type Resp = { linked: boolean; orders: Order[]; updError?: string | null }

const fmtMoney = (n: number) => n > 0 ? Math.round(n).toLocaleString('ru-RU') + ' ₽' : '—'
const monthOf = (s: string) => new Date(s).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', month: 'long', year: 'numeric' })
const fmtDate = (s: string) => new Date(s).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: '2-digit' })

export default function PartnerDocumentsPage() {
  const [data, setData] = useState<Resp | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')

  useEffect(() => {
    let alive = true
    loadJson<Resp>('/api/partner/orders').then(r => {
      if (!alive) return
      if (r.error !== null) setError(r.error)
      else setData(r.data)
      setLoading(false)
    })
    return () => { alive = false }
  }, [])

  const all = useMemo(() => data?.orders ?? [], [data])
  // Поиск по номеру, описанию, сумме и номеру УПД; список — по месяцам (24.11: 130 строк сплошняком).
  const orders = useMemo(() => {
    const t = q.trim().toLowerCase().replace(/\s/g, '')
    if (!t) return all
    return all.filter(o => [o.number, o.summary, String(Math.round(o.amount)), o.upd?.number ?? ''].some(v => String(v).toLowerCase().replace(/\s/g, '').includes(t)))
  }, [all, q])
  const months = useMemo(() => {
    const out: { m: string; list: Order[] }[] = []
    for (const o of orders) {
      const m = monthOf(o.created_at)
      if (out.at(-1)?.m === m) out.at(-1)!.list.push(o); else out.push({ m, list: [o] })
    }
    return out
  }, [orders])
  const updUnknown = !!data?.updError
  const managerSendsInvoice = all.some(o => o.invoice === 'manager')
  const updHint = (o: Order) => updUnknown ? 'УПД — не проверено' : o.lane === 'shipped' ? 'УПД — у менеджера' : 'УПД — после отгрузки'

  return (
    <>
      <div className="top">
        <div>
          <h1>Документы</h1>
          <div className="cap">КП, счета и УПД по вашим заказам</div>
        </div>
        <Link className="primary" href="/partner/new">＋ Новый просчёт</Link>
      </div>

      <div className="wrap">
        {managerSendsInvoice && (
          <div className="info" style={{ marginBottom: 14 }}>
            <span>ℹ️</span>
            <span>По заказам с пометкой «счёт пришлёт менеджер» <b>счёт-спецификацию</b> для оплаты выставляет ваш менеджер M-Glass.</span>
          </div>
        )}
        {updUnknown && (
          <div className="recalc" style={{ marginBottom: 14 }}>Реестр УПД сейчас не прочитался — у строк ниже статус УПД неизвестен. Обновите страницу через минуту.</div>
        )}

        {loading && <div className="note"><div className="s">Загрузка…</div></div>}
        {!loading && error && <div className="note"><div className="t">Документы не загрузились</div><div className="s">{error}</div></div>}
        {!loading && data && !data.linked && <div className="note"><div className="s">Аккаунт ещё не привязан к вашей компании.</div></div>}
        {!loading && data?.linked && all.length === 0 && (
          <div className="note"><div className="s">Пока нет документов. Создайте просчёт в разделе «Калькулятор».</div></div>
        )}
        {!loading && data?.linked && all.length > 0 && (
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Поиск: номер заказа, сумма, № УПД, материал" aria-label="Поиск документов"
            style={{ width: '100%', marginBottom: 14, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 11, padding: '10px 12px', fontSize: 13.5, color: 'var(--ink)', fontFamily: 'inherit', outline: 'none' }} />
        )}
        {!loading && data?.linked && all.length > 0 && orders.length === 0 && (
          <div className="note"><div className="s">По запросу «{q}» ничего нет.</div></div>
        )}
        {!loading && data?.linked && months.map(({ m, list }) => (
          <div key={m} style={{ marginBottom: 14 }}>
          <div className="lane-lbl">{m} <span className="n">{list.length}</span></div>
          <div className="card">
            {list.map((o, i) => (
              <div className={`doc${i === 0 ? ' first' : ''}`} key={o.id}>
                <div className="fi">{o.lane === 'quote' || o.lane === 'submitted' ? 'КП' : '№'}</div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="fn">{o.lane === 'quote' ? 'Просчёт' : 'Заказ'} {o.number} · {fmtMoney(o.amount)}</div>
                  <div className="fm">от {fmtDate(o.created_at)}{o.summary ? ` · ${o.summary}` : ''}{o.positions ? ` · ${o.positions} поз.` : ''}</div>
                </div>
                <div className="dset">
                  <Link className="dl" href={`/partner/order/${o.id}/kp`}>↓ КП</Link>
                  {o.invoice === 'open'
                    ? <Link className="dl" href={`/partner/order/${o.id}/invoice`}>↓ Счёт</Link>
                    : <span className="dno">{INVOICE_HINT[o.invoice]}</span>}
                  {o.upd
                    ? <Link className="dl" href={`/partner/order/${o.id}/upd`}>↓ УПД № {o.upd.number} от {fmtDate(o.upd.docDate)}</Link>
                    : <span className="dno">{updHint(o)}</span>}
                </div>
              </div>
            ))}
          </div>
          </div>
        ))}
      </div>
    </>
  )
}
