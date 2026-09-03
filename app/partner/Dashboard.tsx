'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

// Табло кабинета (перенос дизайна из прототипа). Реальные данные:
//   /api/partner/stats  → KPI + помесячно
//   /api/partner/orders → распределение по стадиям + последнее движение
// Никакой себестоимости/маржи — только клиентские суммы.

type Lane = 'quote' | 'submitted' | 'in_work' | 'shipped'
type Order = {
  id: number; number: string; clientOrderNumber: string | null; created_at: string
  amount: number; lane: Lane; progressPct: number; stage: string; ready: boolean
}
type Stats = { linked: boolean; year: number; ordersCount: number; sumYear: number; avgCheck: number; inWork: number; readyToShip: number; savingsYear: number; byMonth: number[]; topMaterials: { name: string; amount: number }[] }

const MONTHS = ['Я', 'Ф', 'М', 'А', 'М', 'И', 'И', 'А', 'С', 'О', 'Н', 'Д']
const fmtMoney = (n: number) => n > 0 ? Math.round(n).toLocaleString('ru-RU') + ' ₽' : '0 ₽'
const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10, m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few
  return many
}
function ago(iso: string): string {
  const d = new Date(iso), now = new Date()
  const days = Math.floor((now.setHours(0, 0, 0, 0) - new Date(iso).setHours(0, 0, 0, 0)) / 86400000)
  if (days <= 0) return 'сегодня'
  if (days === 1) return 'вчера'
  if (days < 30) return `${days} ${plural(days, 'день', 'дня', 'дней')} назад`
  return d.toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: '2-digit' })
}

function pill(o: Order): { cls: string; label: string } {
  if (o.ready) return { cls: 'p-ready', label: 'Готов к выдаче' }
  if (o.lane === 'shipped') return { cls: 'p-ship', label: 'Отгружен' }
  if (o.lane === 'in_work') return { cls: 'p-work', label: o.stage }
  if (o.lane === 'submitted') return { cls: 'p-sub', label: 'Отправлен в работу' }
  return { cls: 'p-quote', label: 'Просчёт' }
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [orders, setOrders] = useState<Order[] | null>(null)
  const [linked, setLinked] = useState<boolean | null>(null)

  useEffect(() => {
    fetch('/api/partner/stats').then(r => r.json()).then((s: Stats) => {
      setLinked(s.linked)
      if (s.linked) setStats(s)
    }).catch(() => setLinked(false))
    fetch('/api/partner/orders').then(r => r.json()).then((d: { orders?: Order[] }) => setOrders(d.orders ?? [])).catch(() => setOrders([]))
  }, [])

  const year = stats?.year ?? new Date().getFullYear()

  const top = (
    <div className="top">
      <div>
        <h1>Табло</h1>
        <div className="cap">Сводка по вашим заказам за {year} год</div>
      </div>
      <Link className="primary" href="/partner/new">＋ Просчёт</Link>
    </div>
  )

  if (linked === false) return (
    <>{top}<div className="wrap"><div className="note">
      <div className="t">Аккаунт ещё не привязан к вашей компании</div>
      <div className="s">Обратитесь к вашему менеджеру M-Glass, чтобы открыть доступ к заказам.</div>
    </div></div></>
  )
  if (!stats || !orders) return <>{top}<div className="wrap"><div className="note"><div className="s">Загрузка…</div></div></div></>

  // Помесячно — количество заказов (запущенных в работу/отгруженных) за год.
  const byMonthCount = Array(12).fill(0)
  for (const o of orders) {
    if ((o.lane === 'in_work' || o.lane === 'shipped') && new Date(o.created_at).getFullYear() === year) {
      byMonthCount[new Date(o.created_at).getMonth()]++
    }
  }
  const peak = Math.max(...byMonthCount)
  const chartMax = Math.max(peak, 1)

  const dist = [
    { nm: 'Просчёты', c: orders.filter(o => o.lane === 'quote').length, col: 'var(--quote)' },
    { nm: 'Отправлены в работу', c: orders.filter(o => o.lane === 'submitted').length, col: 'var(--amber)' },
    { nm: 'В работе', c: orders.filter(o => o.lane === 'in_work').length, col: 'var(--blue)' },
    { nm: 'Готовы к отгрузке', c: orders.filter(o => o.lane === 'in_work' && o.ready).length, col: 'var(--green)' },
    { nm: `Отгружено за ${year}`, c: orders.filter(o => o.lane === 'shipped' && new Date(o.created_at).getFullYear() === year).length, col: 'var(--border)' },
  ]
  const distMax = Math.max(...dist.map(d => d.c), 1)
  const recent = orders.slice(0, 4)

  const kpis = [
    { k: 'Заказов за год', v: String(stats.ordersCount), d: 'в производстве и отгружено', flat: true },
    { k: 'Сумма за год', v: fmtMoney(stats.sumYear), d: 'по вашим ценам, с НДС', flat: true },
    { k: 'Средний чек', v: fmtMoney(stats.avgCheck), d: 'на заказ', flat: true },
    {
      k: 'Сейчас в работе', v: String(stats.inWork),
      d: stats.readyToShip > 0 ? `${stats.readyToShip} ${plural(stats.readyToShip, 'готов', 'готовы', 'готовы')} к отгрузке` : 'заказов в производстве',
      flat: stats.readyToShip === 0,
    },
  ]

  return (
    <>
      {top}
      <div className="wrap">
        <div className="kpis">
          {kpis.map(t => (
            <div className="kpi" key={t.k}>
              <div className="k">{t.k}</div>
              <div className="v tnum">{t.v}</div>
              <div className={`d${t.flat ? ' flat' : ''}`}>{t.d}</div>
            </div>
          ))}
        </div>

        <div className="split">
          <div className="card">
            <div className="card-h"><h3>Заказы по месяцам</h3><span className="mut">{year} · шт.</span></div>
            <div className="chart">
              {byMonthCount.map((c, i) => (
                <div className={`bar${c === peak && peak > 0 ? ' peak' : ''}`} key={i} title={`${MONTHS[i]}: ${c}`}>
                  <div className="fill" style={{ height: `${Math.round((c / chartMax) * 100)}%` }} />
                  <div className="m">{MONTHS[i]}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="card">
            <div className="card-h"><h3>Где ваши заказы</h3></div>
            {dist.map((d, i) => (
              <div className={`srow${i === 0 ? ' first' : ''}`} key={d.nm}>
                <span className="snm">{d.nm}</span>
                <span className="track"><span className="tk" style={{ width: `${Math.round((d.c / distMax) * 100)}%`, background: d.col }} /></span>
                <span className="ct tnum">{d.c}</span>
              </div>
            ))}
          </div>
        </div>

        {(stats.topMaterials.length > 0 || stats.savingsYear > 0) && (
          <div className="split" style={{ marginTop: 14 }}>
            <div className="card">
              <div className="card-h"><h3>Топ материалов за {year}</h3><span className="mut">по расходам</span></div>
              {stats.topMaterials.length === 0
                ? <div className="srow first"><span className="mut" style={{ fontSize: 13 }}>Пока нет данных.</span></div>
                : stats.topMaterials.map((m, i) => {
                    const max = Math.max(...stats.topMaterials.map(x => x.amount), 1)
                    return (
                      <div className={`srow${i === 0 ? ' first' : ''}`} key={m.name}>
                        <span className="snm" title={m.name} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.name}</span>
                        <span className="track"><span className="tk" style={{ width: `${Math.round((m.amount / max) * 100)}%`, background: 'var(--blue)' }} /></span>
                        <span className="ct tnum" style={{ width: 'auto', whiteSpace: 'nowrap' }}>{fmtMoney(m.amount)}</span>
                      </div>
                    )
                  })}
            </div>
            <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
              <div className="card-h"><h3>Ваша экономия</h3><span className="mut">{year}</span></div>
              <div style={{ padding: 18, flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <div className="v tnum" style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-.02em', color: 'var(--green)' }}>{fmtMoney(stats.savingsYear)}</div>
                <div className="cap" style={{ marginTop: 6 }}>сэкономлено за год благодаря вашей договорной скидке — по сравнению с базовым прайсом.</div>
              </div>
            </div>
          </div>
        )}

        <div className="card" style={{ marginTop: 14 }}>
          <div className="card-h"><h3>Последнее движение</h3><span className="mut">обновляется автоматически</span></div>
          {recent.length === 0 && <div className="srow first"><span className="mut" style={{ fontSize: 13 }}>Пока нет заказов — создайте первый просчёт.</span></div>}
          {recent.map((o, i) => {
            const p = pill(o)
            const clickable = o.lane !== 'quote'
            const inner = (
              <>
                <span className={`pill ${p.cls}`}>{p.label}</span>
                <span style={{ fontWeight: 600 }}>{o.lane === 'quote' ? 'Просчёт' : 'Заказ'} {o.number}</span>
                <span className="mut" style={{ marginLeft: 'auto', fontSize: 12 }}>{ago(o.created_at)}</span>
              </>
            )
            return clickable ? (
              <Link key={o.id} href={`/partner/order/${o.id}`} className={`srow${i === 0 ? ' first' : ''}`} style={{ cursor: 'pointer', textDecoration: 'none' }}>{inner}</Link>
            ) : (
              <div key={o.id} className={`srow${i === 0 ? ' first' : ''}`}>{inner}</div>
            )
          })}
        </div>
      </div>
    </>
  )
}
