'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-browser'
import {
  overdueShipments, unpaidInvoices, staleQuotes, otherBuckets, TOP_LIMIT,
  STALE_QUOTE_MIN_DAYS, STALE_QUOTE_MAX_DAYS,
  type TodayOrder, type TodayInvoice, type PriorityRow,
} from '@/lib/b2b/todayPriorities'
import PlanEditor from './PlanEditor'

// Сверху — три главных дела (ТЗ 4.2): просроченные отгрузки, счета без оплаты, остывающие
// просчёты. Каждое считается в lib/b2b/todayPriorities по данным, которые реально ведутся.
// Остальные дела — ниже, свёрнутыми группами.

const fmt = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₽`

type Tone = 'red' | 'amber' | 'blue' | 'plain'
const TONE: Record<Tone, string> = {
  red:   'border-red-200',
  amber: 'border-amber-200',
  blue:  'border-blue-200',
  plain: 'border-[#e4e4e0]',
}
const DOT: Record<Tone, string> = {
  red: 'bg-red-500', amber: 'bg-amber-500', blue: 'bg-blue-500', plain: 'bg-[#c4c4be]',
}

export default function TodayClient() {
  const [orders, setOrders] = useState<TodayOrder[]>([])
  const [invoices, setInvoices] = useState<TodayInvoice[] | null>(null)   // null — счета недоступны роли
  // А18: план/факт месяца. Плана нет — блок не мешается, просто показываем факт.
  const [plan, setPlan] = useState<{ managerId: string | null; plan: number; launched: number; paid: number; forecast: number; donePct: number | null; name: string }[] | null>(null)
  const [planMonth, setPlanMonth] = useState<string>('')
  const [canSetPlan, setCanSetPlan] = useState(false)
  const [nowTs, setNowTs] = useState(0)   // время берём в эффекте: рендер должен быть чистым
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNowTs(Date.now())
  }, [])

  useEffect(() => {
    (async () => {
      try {
        const sb = createClient()
        const { data: { user } } = await sb.auth.getUser()
        if (!user) { setError('Не авторизован'); return }
        const { data: profile } = await sb.from('users').select('role, see_all_orders').eq('id', user.id).maybeSingle()
        const seeAll = profile?.role === 'admin' || profile?.role === 'ceo' || profile?.see_all_orders === true

        const since = new Date(); since.setDate(since.getDate() - 120)
        let q = sb.from('b2b_orders')
          .select('id,client_name,custom_number,total_sale_inc_vat,total_after_discount,notes,created_at,updated_at,launched_at,created_by_name')
          .is('archived_at', null)
          .gte('created_at', since.toISOString())
          .order('created_at', { ascending: false })
          .limit(1000)
        if (!seeAll) q = q.eq('created_by', user.id)

        const [{ data, error: err }, inv] = await Promise.all([
          q,
          fetch('/api/invoices').then(r => r.ok ? r.json() : null).catch(() => null),
        ])
        if (err) { setError(err.message); return }
        setOrders((data ?? []) as TodayOrder[])
        setInvoices(inv?.invoices ? inv.invoices as TodayInvoice[] : null)
      } finally { setLoading(false) }
    })()
  }, [])

  function loadPlans() {
    fetch('/api/b2b-plans')
      .then(r => r.ok ? r.json() : null)
      .then(j => {
        if (!j?.rows) return
        setPlan(j.rows)
        setPlanMonth(j.month)
        setCanSetPlan(!!j.seeAll)
      })
      .catch(() => {})
  }

  useEffect(() => { loadPlans() }, [])

  const view = useMemo(() => {
    if (!nowTs) return null
    return {
      ship: overdueShipments(orders, nowTs),
      pay: invoices ? unpaidInvoices(invoices, nowTs) : null,
      quotes: staleQuotes(orders, nowTs),
      other: otherBuckets(orders, nowTs),
    }
  }, [orders, invoices, nowTs])

  const topCount = view ? view.ship.length + (view.pay?.length ?? 0) + view.quotes.length : 0

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-5">
        <h1 className="text-[24px] font-bold text-[#111110]">Мой день · B2B</h1>
        <p className="text-[13px] text-[#9a9a95] mt-0.5">
          {loading || !view ? 'Считаю…' : topCount > 0 ? `Главное сегодня: ${topCount}` : 'Главное разобрано'}
        </p>
      </div>

      {error ? (
        <p className="text-[13px] text-red-600">{error}</p>
      ) : loading || !view ? (
        <p className="text-[13px] text-[#9a9a95]">Загрузка…</p>
      ) : (
        <>
          <div className="space-y-3">
            <PriorityCard tone="red" title="Просроченные отгрузки" rows={view.ship}
              caption="Срок прошёл, отметки «Отгружен» нет. Либо заказ не уехал, либо цех его не отметил — в обоих случаях это надо закрыть. Считаются сроки с 01.09, когда вернулась отметка."
              empty="Просроченных отгрузок нет" allHref="/b2b-orders" />
            {view.pay ? (
              <PriorityCard tone="amber" title="Счета ждут оплаты" rows={view.pay}
                caption="Оплата — по платежам из банка и кассы, не по галочке в заказе. Сначала самые давние."
                empty="Все выставленные счета оплачены" allHref="/b2b-invoices" />
            ) : (
              <div className="border border-[#e4e4e0] bg-white rounded-2xl px-4 py-3 text-[12px] text-[#9a9a95]">
                Счета ждут оплаты — реестр счетов вашей роли недоступен.
              </div>
            )}
            <PriorityCard tone="blue" title="Просчёты без движения" rows={view.quotes}
              caption={`Не отправлены клиенту и не менялись ${STALE_QUOTE_MIN_DAYS}–${STALE_QUOTE_MAX_DAYS} дней. Сначала самые крупные — старше в списке просчётов.`}
              empty="Остывающих просчётов нет" allHref="/b2b-quotes" />
          </div>

          {view.other.length > 0 && (
            <div className="mt-6">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-[#9a9a95] mb-2">Ещё дела</p>
              <div className="space-y-2">
                {view.other.map(b => (
                  <PriorityCard key={b.key} tone="plain" title={b.title} caption={b.hint} rows={b.rows} collapsed />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* А18: план/факт по B2B за месяц — ниже дел: сначала что сделать, потом где мы */}
      {plan && plan.length > 0 && (
        <div className="mt-6">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-[#9a9a95] mb-2">План месяца</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {plan.slice(0, 6).map((p, i) => (
              <div key={i} className="border border-[#e4e4e0] bg-white rounded-2xl px-4 py-3">
                <p className="text-[11px] text-[#9a9a95] truncate">{p.name}</p>
                <div className="flex items-baseline gap-2 mt-0.5">
                  <span className="text-[18px] font-bold font-mono text-[#111110]">{fmt(p.launched)}</span>
                  {p.plan > 0 && <span className="text-[12px] text-[#9a9a95]">из {fmt(p.plan)}</span>}
                </div>
                {p.plan > 0 ? (
                  <>
                    <div className="h-1.5 bg-[#f0f0ec] rounded-full mt-2 overflow-hidden">
                      <div className={`h-full rounded-full ${(p.donePct ?? 0) >= 100 ? 'bg-emerald-500' : (p.donePct ?? 0) >= 60 ? 'bg-amber-500' : 'bg-red-500'}`}
                        style={{ width: `${Math.min(100, p.donePct ?? 0)}%` }} />
                    </div>
                    <p className="text-[11px] text-[#6b6b66] mt-1">
                      {p.donePct}% плана · прогноз {fmt(p.forecast)}{p.paid > 0 && ` · оплачено ${fmt(p.paid)}`}
                    </p>
                  </>
                ) : (
                  <p className="text-[11px] text-[#9a9a95] mt-1">
                    план не задан · прогноз {fmt(p.forecast)}{p.paid > 0 && ` · оплачено ${fmt(p.paid)}`}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* А18: ввод плана — владельцу и коммерческому */}
      {canSetPlan && plan && planMonth && (
        <div className="mt-4">
          <PlanEditor rows={plan} month={planMonth} onSaved={loadPlans} />
        </div>
      )}
    </div>
  )
}

function PriorityCard({ title, caption, rows, tone, empty, allHref, collapsed }: {
  title: string
  caption: string
  rows: PriorityRow[]
  tone: Tone
  empty?: string
  allHref?: string
  collapsed?: boolean
}) {
  const [open, setOpen] = useState(!collapsed)
  const [all, setAll] = useState(false)
  const total = rows.reduce((s, r) => s + r.amount, 0)
  const shown = all ? rows : rows.slice(0, TOP_LIMIT)

  if (rows.length === 0 && empty) {
    return (
      <div className="border border-[#e4e4e0] bg-white rounded-2xl px-4 py-3 flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-emerald-500" />
        <span className="text-[13px] font-semibold text-[#111110]">{title}</span>
        <span className="text-[12px] text-[#9a9a95]">— {empty}</span>
      </div>
    )
  }

  return (
    <div className={`border ${TONE[tone]} bg-white rounded-2xl overflow-hidden`}>
      <button onClick={() => setOpen(o => !o)} className="w-full px-4 py-3 flex items-start justify-between gap-3 text-left">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[14px] font-bold text-[#111110]">
            <span className={`w-2 h-2 rounded-full ${DOT[tone]}`} />{title}
          </p>
          <p className="text-[11px] text-[#8a8a85] mt-0.5">{caption}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-[18px] font-bold font-mono text-[#111110] leading-none">{rows.length}</p>
          <p className="text-[11px] font-mono text-[#6b6b66] mt-1">{fmt(total)}</p>
        </div>
      </button>

      {open && (
        <>
          <div className="divide-y divide-[#f0f0ec] border-t border-[#f0f0ec]">
            {shown.map(r => (
              <div key={r.key} className="px-4 py-2 grid gap-x-3 gap-y-1 items-center grid-cols-[1fr_auto] md:grid-cols-[minmax(0,1fr)_110px_150px_110px_auto]">
                <div className="min-w-0">
                  <p className="text-[12px] font-medium text-[#111110] truncate">
                    <Link href={r.href} className="hover:underline">{r.ref}</Link> · {r.client}
                  </p>
                  {r.note && <p className="text-[11px] text-[#8a8a85] truncate">{r.note}</p>}
                </div>
                <span className="text-[12px] font-mono text-[#111110] text-right">{fmt(r.amount)}</span>
                <span className={`text-[11px] md:text-right ${tone === 'red' ? 'text-red-600' : 'text-[#6b6b66]'}`}>{r.daysLabel}</span>
                <span className="text-[11px] text-[#6b6b66] truncate md:text-right">{r.owner ?? '—'}</span>
                <Link href={r.href}
                  className="justify-self-end text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-[#111110] text-white hover:bg-[#2a2a28] whitespace-nowrap">
                  {r.action}
                </Link>
              </div>
            ))}
          </div>
          {rows.length > TOP_LIMIT && (
            <div className="px-4 py-2 border-t border-[#f0f0ec] flex items-center gap-4">
              <button onClick={() => setAll(a => !a)} className="text-[12px] font-semibold text-blue-600 hover:underline">
                {all ? 'Свернуть' : `Все ${rows.length} →`}
              </button>
              {allHref && <Link href={allHref} className="text-[11px] text-[#9a9a95] hover:underline">открыть список</Link>}
            </div>
          )}
        </>
      )}
    </div>
  )
}
