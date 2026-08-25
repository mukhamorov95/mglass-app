'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-browser'
import { finalTotalOf } from '@/lib/b2b/priceOverride'
import { deadlineFor } from '@/lib/b2b/deadline'
import type { PriceApproval } from '@/lib/b2b/priceOverride'

// Экран собран из того, что уже есть в данных: ничего не додумывает и не прогнозирует.
// Каждая карточка — это конкретное действие менеджера, а не метрика для отчёта.

type Row = {
  id: number
  client_name: string
  custom_number: string | null
  total_sale_inc_vat: number
  total_after_discount: number
  notes: string | null
  created_at: string
  updated_at: string | null
  launched_at: string | null
  created_by: string | null
}

type Notes = Record<string, unknown>

const fmt = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₽`
const parseNotes = (n: string | null): Notes => {
  if (!n) return {}
  try { const p = JSON.parse(n); return p && typeof p === 'object' ? p as Notes : {} } catch { return {} }
}
const daysSince = (iso: string, now: number) => Math.floor((now - new Date(iso).getTime()) / 86_400_000)
const dayLabel = (d: Date) => d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })

type Bucket = {
  key: string
  title: string
  hint: string
  tone: 'red' | 'amber' | 'emerald' | 'blue' | 'plain'
  href: string
  rows: { row: Row; note: string }[]
}

const TONE: Record<Bucket['tone'], string> = {
  red:     'border-red-200 bg-red-50/50',
  amber:   'border-amber-200 bg-amber-50/50',
  emerald: 'border-emerald-200 bg-emerald-50/50',
  blue:    'border-blue-200 bg-blue-50/50',
  plain:   'border-[#e4e4e0] bg-white',
}

export default function TodayClient() {
  const [rows, setRows] = useState<Row[]>([])
  // А18: план/факт месяца. Плана нет — блок не мешается, просто показываем факт.
  const [plan, setPlan] = useState<{ plan: number; launched: number; paid: number; forecast: number; donePct: number | null; name: string }[] | null>(null)
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
          .select('id,client_name,custom_number,total_sale_inc_vat,total_after_discount,notes,created_at,updated_at,launched_at,created_by')
          .is('archived_at', null)
          .gte('created_at', since.toISOString())
          .order('created_at', { ascending: false })
          .limit(1000)
        if (!seeAll) q = q.eq('created_by', user.id)

        const { data, error: err } = await q
        if (err) { setError(err.message); return }
        setRows((data ?? []) as Row[])
      } finally { setLoading(false) }
    })()
  }, [])

  useEffect(() => {
    fetch('/api/b2b-plans')
      .then(r => r.ok ? r.json() : null)
      .then(j => { if (j?.rows) setPlan(j.rows) })
      .catch(() => {})
  }, [])

  const buckets = useMemo<Bucket[]>(() => {
    const answered: Bucket['rows'] = []
    const opened: Bucket['rows'] = []
    const agreed: Bucket['rows'] = []
    const waitingOwner: Bucket['rows'] = []
    const stale: Bucket['rows'] = []
    const awaitingPay: Bucket['rows'] = []
    const shipping: Bucket['rows'] = []

    const now = nowTs || 0
    const weekAhead = now + 7 * 86_400_000

    for (const row of rows) {
      const n = parseNotes(row.notes)
      const status = String(n.status ?? 'quote')
      const launched = !!row.launched_at || status === 'sent' || status === 'confirmed'
      const resp = n.client_response as { action?: string; comment?: string | null; at?: string } | undefined
      const approval = n.price_approval as PriceApproval | undefined
      const isTemplate = n.is_template === true
      if (isTemplate) continue

      if (resp?.action === 'question') {
        answered.push({ row, note: resp.comment ? `«${resp.comment}»` : 'клиент задал вопрос' })
      }
      if (!launched && approval?.needed) {
        waitingOwner.push({ row, note: `маржа ${approval.margin}% — ждёт владельца` })
      }
      if (!launched && status === 'agreed') {
        agreed.push({ row, note: 'согласовано — запускать в работу' })
      }
      if (!launched && n.public_opened_at && !resp) {
        opened.push({ row, note: `открыл ${daysSince(String(n.public_opened_at), now)} дн. назад, молчит` })
      }
      if (!launched && status === 'quote' && !n.public_opened_at) {
        const d = daysSince(row.updated_at ?? row.created_at, now)
        if (d >= 3) stale.push({ row, note: `без движения ${d} дн.` })
      }
      if (launched && n.payment_status !== 'paid') {
        const paid = n.payment_status === 'partial' ? Number(n.prepayment_amount) || 0 : 0
        const debt = finalTotalOf(row) - paid
        awaitingPay.push({ row, note: paid > 0 ? `остаток ${fmt(debt)}` : `ждём оплату ${fmt(debt)}` })
      }
      if (launched && !n.shipped_date) {
        const dl = deadlineFor(n, row.created_at)
        if (dl.getTime() <= weekAhead) {
          const overdue = dl.getTime() < now
          shipping.push({ row, note: overdue ? `просрочено с ${dayLabel(dl)}` : `отгрузка ${dayLabel(dl)}` })
        }
      }
    }

    const sortByUrgency = (a: Bucket['rows'][number], b: Bucket['rows'][number]) =>
      finalTotalOf(b.row) - finalTotalOf(a.row)

    return ([
      { key: 'answered',  title: 'Вопрос от клиента',        hint: 'ответить сегодня',                tone: 'blue',    href: '/b2b-quotes', rows: answered },
      { key: 'agreed',    title: 'Согласовано клиентом',     hint: 'запустить в работу',              tone: 'emerald', href: '/b2b-quotes', rows: agreed },
      { key: 'shipping',  title: 'Отгрузка на этой неделе',  hint: 'предупредить клиента',            tone: 'amber',   href: '/b2b-orders', rows: shipping },
      { key: 'pay',       title: 'Ждём оплату',              hint: 'напомнить и выставить счёт',      tone: 'red',     href: '/b2b-invoices', rows: awaitingPay },
      { key: 'opened',    title: 'Открыл КП и молчит',       hint: 'позвонить',                       tone: 'plain',   href: '/b2b-quotes', rows: opened },
      { key: 'stale',     title: 'Просчёты без движения',    hint: 'отправить клиенту',               tone: 'plain',   href: '/b2b-quotes', rows: stale },
      { key: 'owner',     title: 'Цена у владельца',         hint: 'ждём решения',                    tone: 'amber',   href: '/b2b-quotes', rows: waitingOwner },
    ] as Bucket[]).map(b => ({ ...b, rows: b.rows.sort(sortByUrgency) })).filter(b => b.rows.length > 0)
  }, [rows, nowTs])

  const totalActions = buckets.reduce((s, b) => s + b.rows.length, 0)

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-5">
        <h1 className="text-[24px] font-bold text-[#111110]">Мой день · B2B</h1>
        <p className="text-[13px] text-[#9a9a95] mt-0.5">
          {loading ? 'Считаю…' : totalActions > 0 ? `${totalActions} дел требуют вас` : 'Всё разобрано'}
        </p>
      </div>

      {/* А18: план/факт по B2B за месяц */}
      {plan && plan.length > 0 && (
        <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
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
      )}

      {error ? (
        <p className="text-[13px] text-red-600">{error}</p>
      ) : loading ? (
        <p className="text-[13px] text-[#9a9a95]">Загрузка…</p>
      ) : buckets.length === 0 ? (
        <div className="bg-white border border-[#e4e4e0] rounded-2xl px-5 py-10 text-center">
          <p className="text-[15px] font-semibold text-[#111110]">Чисто</p>
          <p className="text-[12px] text-[#9a9a95] mt-1">Ни зависших просчётов, ни неоплаченных заказов, ни отгрузок на неделе.</p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {buckets.map(b => (
            <div key={b.key} className={`border rounded-2xl overflow-hidden ${TONE[b.tone]}`}>
              <div className="px-4 py-2.5 flex items-baseline justify-between gap-2">
                <div>
                  <p className="text-[13px] font-bold text-[#111110]">{b.title}</p>
                  <p className="text-[11px] text-[#6b6b66]">{b.hint}</p>
                </div>
                <span className="text-[18px] font-bold font-mono text-[#111110]">{b.rows.length}</span>
              </div>
              <div className="bg-white/70 divide-y divide-[#f0f0ec] max-h-72 overflow-y-auto">
                {b.rows.slice(0, 12).map(({ row, note }) => (
                  <Link key={row.id} href={b.href}
                    className="px-4 py-2 flex items-center justify-between gap-3 hover:bg-white transition-colors">
                    <div className="min-w-0">
                      <p className="text-[12px] font-medium text-[#111110] truncate">
                        {row.custom_number?.trim() || `#${row.id}`} · {row.client_name}
                      </p>
                      <p className="text-[11px] text-[#8a8a85] truncate">{note}</p>
                    </div>
                    <span className="text-[12px] font-mono text-[#6b6b66] whitespace-nowrap">{fmt(finalTotalOf(row))}</span>
                  </Link>
                ))}
                {b.rows.length > 12 && (
                  <Link href={b.href} className="block px-4 py-2 text-[11px] text-blue-600 hover:underline">
                    ещё {b.rows.length - 12} →
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
