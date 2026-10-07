'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { loadJson } from '@/lib/toast'
import type { ActivityEvent, WaitingAction } from '@/lib/partner/activity'

// Табло кабинета (перенос дизайна из прототипа). Реальные данные:
//   /api/partner/stats    → KPI + помесячно
//   /api/partner/orders   → распределение по стадиям
//   /api/partner/activity → последние события по датам отметок, оплат, документов
//                           и «Ждут вашего действия» (состояние, без рассылок)
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

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [orders, setOrders] = useState<Order[] | null>(null)
  const [activity, setActivity] = useState<{ events: ActivityEvent[]; waiting: WaitingAction[] } | null>(null)
  const [activityErr, setActivityErr] = useState<string | null>(null)
  const [linked, setLinked] = useState<boolean | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    Promise.all([
      loadJson<Stats>('/api/partner/stats'),
      loadJson<{ orders?: Order[] }>('/api/partner/orders'),
    ]).then(([s, o]) => {
      if (!alive) return
      if (s.error !== null || o.error !== null) { setLoadErr((s.error ?? o.error)!); return }
      setLinked(s.data.linked)
      if (s.data.linked) setStats(s.data)
      setOrders(o.data.orders ?? [])
    })
    // Лента и «ждут действия» — отдельно: их сбой не прячет сводку.
    loadJson<{ events: ActivityEvent[]; waiting: WaitingAction[] }>('/api/partner/activity').then(r => {
      if (!alive) return
      if (r.error !== null) setActivityErr(r.error)
      else setActivity({ events: r.data.events ?? [], waiting: r.data.waiting ?? [] })
    })
    return () => { alive = false }
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
  if (loadErr) return (
    <>{top}<div className="wrap"><div className="note">
      <div className="t">Сводка не загрузилась</div>
      <div className="s">{loadErr}. Обновите страницу через минуту.</div>
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

        {activity && activity.waiting.length > 0 && (
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="card-h"><h3>Ждут вашего действия</h3><span className="mut">{activity.waiting.length}</span></div>
            {activity.waiting.slice(0, 8).map((w, i) => (
              <Link key={`${w.kind}-${w.orderId}`} href={`/partner/order/${w.orderId}`} className={`srow${i === 0 ? ' first' : ''}`} style={{ cursor: 'pointer', textDecoration: 'none' }}>
                <span className={`pill ${w.kind === 'payment' ? 'p-sub' : w.kind === 'drawing' ? 'p-work' : 'p-quote'}`}>{w.kind === 'payment' ? 'Оплата' : w.kind === 'drawing' ? 'Чертёж' : 'Получение'}</span>
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}><b>{w.number}</b> · {w.text}</span>
              </Link>
            ))}
            {activity.waiting.length > 8 && <div className="srow"><span className="mut" style={{ fontSize: 12.5 }}>и ещё {activity.waiting.length - 8} — в разделе «Заказы в работе»</span></div>}
          </div>
        )}

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
          <div className="card-h"><h3>Последние события</h3><span className="mut">отметки цеха, оплаты, документы</span></div>
          {activityErr && <div className="srow first"><span className="perr" style={{ marginTop: 0 }}>Лента не загрузилась: {activityErr}</span></div>}
          {!activityErr && !activity && <div className="srow first"><span className="mut" style={{ fontSize: 13 }}>Загрузка…</span></div>}
          {activity && activity.events.length === 0 && <div className="srow first"><span className="mut" style={{ fontSize: 13 }}>Пока событий нет — они появятся, когда заказ пойдёт в работу.</span></div>}
          {activity?.events.map((e, i) => (
            <Link key={`${e.orderId}-${e.at}-${e.text}`} href={`/partner/order/${e.orderId}`} className={`srow${i === 0 ? ' first' : ''}`} style={{ cursor: 'pointer', textDecoration: 'none' }}>
              <span className={`pill ${e.tone === 'money' ? 'p-ready' : e.tone === 'doc' ? 'p-sub' : e.tone === 'done' ? 'p-work' : 'p-quote'}`}>{e.tone === 'money' ? 'Оплата' : e.tone === 'doc' ? 'Документ' : e.tone === 'done' ? 'Цех' : 'Заказ'}</span>
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}><b>{e.number}</b> · {e.text}</span>
              <span className="mut" style={{ marginLeft: 'auto', fontSize: 12, whiteSpace: 'nowrap' }}>{ago(e.at)}</span>
            </Link>
          ))}
        </div>
      </div>
    </>
  )
}
