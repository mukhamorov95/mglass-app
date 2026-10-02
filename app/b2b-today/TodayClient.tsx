'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-browser'
import {
  overdueShipments, splitShipments, unpaidInvoices, staleQuotes, otherBuckets, TOP_LIMIT,
  STALE_QUOTE_MIN_DAYS, STALE_QUOTE_MAX_DAYS, SHIP_RECENT_DAYS,
  type TodayOrder, type TodayInvoice, type PriorityRow,
} from '@/lib/b2b/todayPriorities'
import { loadTodayOrders } from '@/lib/b2b/loadTodayOrders'
import PlanEditor from './PlanEditor'
import { responseError, NETWORK_ERROR } from '@/lib/toast'
import { ANSWER_SLA_MIN, inquiryTitle, minutesBetween, durationLabel, type Inquiry } from '@/lib/b2b/inquiries'

// Сверху — три главных дела (ТЗ 4.2): просроченные отгрузки, счета без оплаты, остывающие
// просчёты. Каждое считается в lib/b2b/todayPriorities по данным, которые реально ведутся.
// Остальные дела — ниже, свёрнутыми группами.

const fmt = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₽`
const ordersWord = (n: number) => {
  const d10 = n % 10, d100 = n % 100
  if (d10 === 1 && d100 !== 11) return 'заказ'
  if (d10 >= 2 && d10 <= 4 && (d100 < 12 || d100 > 14)) return 'заказа'
  return 'заказов'
}

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
  const [invErr, setInvErr] = useState<string | null>(null)                 // сбой загрузки — не то же, что «недоступны роли»
  const [planErr, setPlanErr] = useState<string | null>(null)
  // А18: план/факт месяца. Плана нет — блок не мешается, просто показываем факт.
  const [plan, setPlan] = useState<{ managerId: string | null; plan: number; launched: number; paid: number; forecast: number; donePct: number | null; name: string }[] | null>(null)
  const [planMonth, setPlanMonth] = useState<string>('')
  const [canSetPlan, setCanSetPlan] = useState(false)
  const [nowTs, setNowTs] = useState(0)   // время берём в эффекте: рендер должен быть чистым
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Входящие без ответа: первое дело дня — от скорости ответа зависит уровень сервиса Авито.
  const [inquiries, setInquiries] = useState<Inquiry[] | null>(null)
  const [inqErr, setInqErr] = useState<string | null>(null)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNowTs(Date.now())
  }, [])

  useEffect(() => {
    (async () => {
      try {
        const [loaded, inv] = await Promise.all([
          loadTodayOrders(createClient()),
          fetch('/api/invoices')
            .then(async (r): Promise<{ body?: { invoices?: TodayInvoice[] } | null; error?: string }> => {
              if (r.ok) return { body: await r.json().catch(() => null) as { invoices?: TodayInvoice[] } | null }
              // 403 — реестр счетов закрыт роли; остальное — сбой, о нём говорим прямо.
              return r.status === 403 ? { body: null } : { error: await responseError(r) }
            })
            .catch((): { body?: undefined; error: string } => ({ error: NETWORK_ERROR })),
        ])
        if (loaded.error) { setError(loaded.error); return }
        setOrders(loaded.orders)
        if (inv.error) setInvErr(inv.error)
        else setInvoices(inv.body?.invoices ? inv.body.invoices : null)
      } finally { setLoading(false) }
    })()
  }, [])

  function loadPlans() {
    fetch('/api/b2b-plans')
      .then(async r => {
        if (!r.ok) { setPlanErr(await responseError(r)); return }
        const j = await r.json()
        setPlanErr(null)
        if (!j?.rows) return
        setPlan(j.rows)
        setPlanMonth(j.month)
        setCanSetPlan(!!j.seeAll)
      })
      .catch(() => setPlanErr(NETWORK_ERROR))
  }

  useEffect(() => { loadPlans() }, [])

  useEffect(() => {
    fetch('/api/b2b/inquiries?status=new')
      .then(async r => {
        if (r.status === 403) return
        if (!r.ok) { setInqErr(await responseError(r)); return }
        const j = await r.json().catch(() => null) as { inquiries?: Inquiry[] } | null
        setInquiries(j?.inquiries ?? [])
      })
      .catch(() => setInqErr(NETWORK_ERROR))
  }, [])

  const view = useMemo(() => {
    if (!nowTs) return null
    return {
      ship: splitShipments(overdueShipments(orders, nowTs)),
      pay: invoices ? unpaidInvoices(invoices, nowTs) : null,
      quotes: staleQuotes(orders, nowTs),
      other: otherBuckets(orders, nowTs),
    }
  }, [orders, invoices, nowTs])

  const topCount = view ? view.ship.recent.length + (view.pay?.length ?? 0) + view.quotes.length : 0
  const oldShip = view?.ship.old ?? []
  const oldShipSum = oldShip.reduce((s, r) => s + r.amount, 0)

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-5">
        <h1 className="text-[24px] font-bold text-[#111110]">Мой день · B2B</h1>
        <p className="text-[13px] text-[#9a9a95] mt-0.5">
          {loading || !view ? 'Считаю…' : topCount > 0 ? `Главное сегодня: ${topCount}${invErr ? ' (без счетов — не загрузились)' : ''}` : invErr ? 'Счета не загрузились — список дел неполный' : 'Главное разобрано'}
        </p>
      </div>

      {error ? (
        <p className="text-[13px] text-red-600">{error}</p>
      ) : loading || !view ? (
        <p className="text-[13px] text-[#9a9a95]">Загрузка…</p>
      ) : (
        <>
          <div className="space-y-3">
            {inqErr && <p className="text-[12px] text-red-600">Заявки не загрузились: {inqErr}</p>}
            {inquiries && inquiries.length > 0 && (
              <InquiriesCard rows={inquiries} nowIso={new Date(nowTs).toISOString()} />
            )}
            <PriorityCard tone="red" title="Просроченные отгрузки" rows={view.ship.recent}
              caption={`Срок прошёл в последние ${SHIP_RECENT_DAYS} дней, отметки «Отгружен» нет. Либо заказ не уехал, либо его не отметили — закройте с датой отгрузки.`}
              empty={`За ${SHIP_RECENT_DAYS} дней просроченных отгрузок нет`} allHref="/b2b-today/shipments" />
            {oldShip.length > 0 && (
              <div className="border border-[#e4e4e0] bg-white rounded-2xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
                <p className="text-[12px] text-[#6b6b66]">
                  <span className="font-semibold text-[#111110]">{oldShip.length}</span> {ordersWord(oldShip.length)} старше {SHIP_RECENT_DAYS} дней без отметки об отгрузке
                  <span className="font-mono"> · {fmt(oldShipSum)}</span>. Почти всегда это отгружено, но не отмечено.
                </p>
                <Link href="/b2b-today/shipments" className="text-[11px] font-semibold px-2.5 py-1 rounded-lg border border-[#e4e4e0] text-[#111110] hover:bg-[#f5f5f3] whitespace-nowrap">
                  Разобрать
                </Link>
              </div>
            )}
            {invErr ? (
              <div role="alert" className="border border-[#eec5bf] bg-white rounded-2xl px-4 py-3 text-[12px] text-[#c23a2b]">
                Счета ждут оплаты — не удалось загрузить: {invErr}. Обновите страницу.
              </div>
            ) : view.pay ? (
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

      {planErr && (
        <div role="alert" className="mt-6 border border-[#eec5bf] bg-white rounded-2xl px-4 py-3 text-[12px] text-[#c23a2b]">
          План месяца не загрузился: {planErr}. Обновите страницу.
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

function InquiriesCard({ rows, nowIso }: { rows: Inquiry[]; nowIso: string }) {
  const late = rows.filter(r => minutesBetween(r.created_at, nowIso) > ANSWER_SLA_MIN).length
  return (
    <div className="border border-red-200 bg-white rounded-2xl overflow-hidden">
      <div className="px-4 py-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[14px] font-bold text-[#111110]">
            <span className="w-2 h-2 rounded-full bg-red-500" />Заявки без ответа
          </p>
          <p className="text-[11px] text-[#8a8a85] mt-0.5">
            Ответ в чате Авито — за {ANSWER_SLA_MIN} минут{late > 0 ? `; дольше уже ждут: ${late}` : ''}. Ответили — отметьте в заявках.
          </p>
        </div>
        <Link href="/b2b-crm/inquiries" className="shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-[#111110] text-white hover:bg-[#2a2a28]">
          Заявки · {rows.length}
        </Link>
      </div>
      <div className="divide-y divide-[#f0f0ec] border-t border-[#f0f0ec]">
        {rows.slice(0, TOP_LIMIT).map(r => {
          const min = minutesBetween(r.created_at, nowIso)
          return (
            <div key={r.id} className="px-4 py-2 flex items-center justify-between gap-3">
              <p className="text-[12px] text-[#111110] truncate min-w-0">
                <span className="font-medium">{inquiryTitle(r)}</span>
                {r.request && <span className="text-[#8a8a85]"> · {r.request}</span>}
              </p>
              <span className={`text-[11px] shrink-0 ${min > ANSWER_SLA_MIN ? 'text-red-600 font-semibold' : 'text-[#6b6b66]'}`}>{durationLabel(min)}</span>
            </div>
          )
        })}
      </div>
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
                <Link href={r.actionHref ?? r.href}
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
