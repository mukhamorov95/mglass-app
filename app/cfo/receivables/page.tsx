'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { liveOrders, orderAmount } from '@/lib/liveOrders'

// Дебиторская задолженность: кто должен, сколько и сколько дней.
// B2B — из b2b_orders (счёт: notes.stages.invoice_sent/invoice_paid, notes.payment_status,
// предоплата notes.prepayment_amount, долг = сумма − предоплата).
// Только не архивные заказы (liveOrders): архивные дубли импорта давали здесь
// «долг» 33 964 ₽, которого /ceo не видел — две страницы, одна метрика, разные ответы.
// B2C — договоры/счета (contracts, status sent/signed): оплата живёт в AmoCRM,
// здесь список выставленного для контроля менеджерами.

type Stages = Record<string, string | undefined>
type Notes = {
  status?: string
  payment_status?: 'unpaid' | 'partial' | 'paid'
  prepayment_amount?: number
  stages?: Stages
}
type B2BOrder = {
  id: number
  custom_number: string | null
  client_name: string | null
  total_sale_inc_vat: number | null
  total_after_discount: number | null
  created_at: string
  launched_at: string | null
  notes: Notes
}
type Contract = {
  id: number
  number: string | null
  total: number | null
  status: string
  customer: { name?: string; full_name?: string } | null
  created_at: string
}

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₽'
const parseNotes = (raw: unknown): Notes => {
  if (!raw) return {}
  if (typeof raw === 'string') { try { return JSON.parse(raw) } catch { return {} } }
  return raw as Notes
}
const daysSince = (iso: string | null | undefined): number | null => {
  if (!iso) return null
  const d = new Date(iso).getTime()
  if (Number.isNaN(d)) return null
  return Math.floor((Date.now() - d) / 86400000)
}
// Вёдра старения долга — стандартный aging: чем правее, тем тревожнее
const BUCKETS = [
  { key: 'b7',  label: '0–7 дней',   max: 7,        cls: 'text-emerald-700' },
  { key: 'b14', label: '8–14 дней',  max: 14,       cls: 'text-amber-600' },
  { key: 'b30', label: '15–30 дней', max: 30,       cls: 'text-orange-600' },
  { key: 'b99', label: '30+ дней',   max: Infinity, cls: 'text-red-600' },
]
const bucketOf = (days: number) => BUCKETS.find(b => days <= b.max)!

export default function ReceivablesPage() {
  const sb = createClient()
  const [orders, setOrders] = useState<B2BOrder[]>([])
  const [contracts, setContracts] = useState<Contract[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const cols = 'id, custom_number, client_name, total_sale_inc_vat, total_after_discount, created_at, launched_at, notes'
    // Постранично: PostgREST режет ответ на 1000 строках, живых заказов больше —
    // без этого просроченный счёт мог просто не доехать до экрана.
    const bo: B2BOrder[] = []
    const { data: ct } = await sb.from('contracts')
      .select('id, number, total, status, customer, created_at')
      .in('status', ['sent', 'signed'])
      .order('created_at', { ascending: false }).limit(300)
    for (let from = 0; ; from += 1000) {
      const { data, error } = await liveOrders(sb, cols).order('created_at', { ascending: false }).range(from, from + 999)
      if (error || !data?.length) break
      bo.push(...(data as unknown as B2BOrder[]))
      if (data.length < 1000) break
    }
    setOrders(bo.map(o => ({ ...o, notes: parseNotes(o.notes) })))
    setContracts((ct ?? []) as Contract[])
    setLoading(false)
  }, [sb])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load().catch(() => setLoading(false)) }, [load])

  // Дебиторка B2B: счёт выставлен, оплаты нет (или частичная)
  const rows = useMemo(() => {
    return orders.flatMap(o => {
      const n = o.notes
      const st = n.stages ?? {}
      if (!['confirmed', 'agreed', 'sent'].includes(n.status ?? '')) return []
      if (!st.invoice_sent) return []                 // счёт не выставлялся
      if (st.invoice_paid || n.payment_status === 'paid') return []
      const total = orderAmount(o)
      const prepay = n.payment_status === 'partial' ? (n.prepayment_amount || 0) : (n.prepayment_amount || 0)
      const debt = Math.max(0, total - prepay)
      if (debt <= 0) return []
      const days = daysSince(st.invoice_sent) ?? 0
      return [{ order: o, total, prepay, debt, days, bucket: bucketOf(days) }]
    }).sort((a, b) => b.days - a.days)
  }, [orders])

  // Запущено в работу, а счёт так и не выставлен — упущенные деньги.
  // Только свежие заказы (60 дней): исторический массив без stages.invoice_sent — не сигнал.
  const noInvoice = useMemo(() =>
    orders.filter(o => o.notes.status === 'confirmed' && !(o.notes.stages?.invoice_sent)
      && !(o.notes.stages?.invoice_paid) && o.notes.payment_status !== 'paid'
      && (daysSince(o.launched_at ?? o.created_at) ?? 999) <= 60),
  [orders])

  const totals = useMemo(() => {
    const sum = rows.reduce((s, r) => s + r.debt, 0)
    const byBucket = BUCKETS.map(b => ({
      ...b, sum: rows.filter(r => r.bucket.key === b.key).reduce((s, r) => s + r.debt, 0),
      count: rows.filter(r => r.bucket.key === b.key).length,
    }))
    return { sum, byBucket }
  }, [rows])

  // Оплата пишется только через единый роут (Д2): notes + payments + ведомость.
  async function postPayment(id: number, body: { status: string; amount?: number }) {
    setBusyId(id)
    try {
      const r = await fetch(`/api/b2b-orders/${id}/payment`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d.error ?? 'Не удалось отметить оплату'); return }
      await load()
    } finally { setBusyId(null) }
  }

  const markPaid = (o: B2BOrder) => postPayment(o.id, { status: 'paid' })

  async function markPartial(o: B2BOrder) {
    const raw = window.prompt('Сколько оплачено всего по заказу, ₽ (накопленная предоплата)?', String(o.notes.prepayment_amount || ''))
    if (raw == null) return
    const amount = Number(raw.replace(/\s/g, '')) || 0
    await postPayment(o.id, { status: amount > 0 ? 'partial' : 'unpaid', amount })
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center text-[13px] text-[#8a8a85]">Загрузка…</div>

  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-20">
      <div className="bg-white border-b border-[#e4e4e0] px-5 pt-6 pb-4">
        <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">Дебиторская задолженность</h1>
        <p className="text-[12px] text-[#9a9a95] mt-0.5">Кто должен, сколько и сколько дней. B2B — счета из заказов; розница — выставленные договоры/счета.</p>
      </div>

      <div className="px-5 pt-4 space-y-4 max-w-[1280px]">
        {/* Итоги и старение */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="bg-[#111110] text-white rounded-xl p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#8a8a85]">Всего должны (B2B)</p>
            <p className="text-[20px] font-bold font-mono mt-1">{fmt(totals.sum)}</p>
            <p className="text-[11px] text-[#c4c4be]">{rows.length} счёт(ов)</p>
          </div>
          {totals.byBucket.map(b => (
            <div key={b.key} className="bg-white border border-[#e4e4e0] rounded-xl p-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#9a9a95]">{b.label}</p>
              <p className={`text-[18px] font-bold font-mono mt-1 ${b.cls}`}>{fmt(b.sum)}</p>
              <p className="text-[11px] text-[#9a9a95]">{b.count} счёт(ов)</p>
            </div>
          ))}
        </div>

        {/* B2B: неоплаченные счета */}
        <div className="bg-white rounded-xl border border-[#e4e4e0] overflow-hidden">
          <p className="px-4 pt-4 pb-2 text-[11px] font-bold uppercase tracking-widest text-[#9a9a95]">B2B · счёт выставлен, оплаты нет</p>
          {rows.length === 0 ? (
            <p className="px-4 pb-4 text-[12px] text-[#c4c4be]">Неоплаченных счетов нет 🎉</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-[#9a9a95] border-b border-[#f0f0ec]">
                    <th className="px-4 py-2">Заказ</th><th className="px-2 py-2">Клиент</th>
                    <th className="px-2 py-2 text-right">Сумма</th><th className="px-2 py-2 text-right">Оплачено</th>
                    <th className="px-2 py-2 text-right">Долг</th><th className="px-2 py-2 text-right">Счёт выставлен</th>
                    <th className="px-2 py-2 text-right">Дней</th><th className="px-4 py-2 text-right">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ order: o, total, prepay, debt, days, bucket }) => (
                    <tr key={o.id} className="border-b border-[#f8f8f7] hover:bg-[#fafaf9]">
                      <td className="px-4 py-2 font-mono font-semibold">
                        <a href={`/b2b-orders`} className="hover:underline">№{o.custom_number || o.id}</a>
                      </td>
                      <td className="px-2 py-2">{o.client_name || '—'}</td>
                      <td className="px-2 py-2 text-right font-mono">{fmt(total)}</td>
                      <td className="px-2 py-2 text-right font-mono text-[#6b6b66]">{prepay > 0 ? fmt(prepay) : '—'}</td>
                      <td className={`px-2 py-2 text-right font-mono font-bold ${bucket.cls}`}>{fmt(debt)}</td>
                      <td className="px-2 py-2 text-right text-[#6b6b66]">{o.notes.stages?.invoice_sent ? new Date(o.notes.stages.invoice_sent).toLocaleDateString('ru-RU') : '—'}</td>
                      <td className={`px-2 py-2 text-right font-mono font-semibold ${bucket.cls}`}>{days}</td>
                      <td className="px-4 py-2 text-right whitespace-nowrap">
                        <button onClick={() => markPartial(o)} disabled={busyId === o.id}
                          className="text-[11px] border border-[#e4e4e0] rounded-lg px-2 py-1 hover:bg-[#f5f5f3] disabled:opacity-40 mr-1">Частично</button>
                        <button onClick={() => markPaid(o)} disabled={busyId === o.id}
                          className="text-[11px] font-semibold bg-emerald-600 text-white rounded-lg px-2 py-1 hover:bg-emerald-700 disabled:opacity-40">✓ Оплачен</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* B2B: в работе без счёта */}
        <div className="bg-amber-50 rounded-xl border border-amber-200 p-4">
          <p className="text-[11px] font-bold uppercase tracking-widest text-amber-700">⚠ Запущено в производство, а счёт не выставлен — {noInvoice.length} заказ(ов)</p>
          {noInvoice.length === 0 ? (
            <p className="text-[12px] text-amber-700 mt-1">Таких нет — все запущенные заказы со счетами.</p>
          ) : (
            <div className="mt-2 flex flex-wrap gap-2">
              {noInvoice.map(o => (
                <a key={o.id} href="/b2b-orders" className="text-[12px] bg-white border border-amber-200 rounded-lg px-2.5 py-1 hover:bg-amber-100">
                  №{o.custom_number || o.id} · {o.client_name || '—'} · <span className="font-mono">{fmt(orderAmount(o))}</span>
                </a>
              ))}
            </div>
          )}
          <p className="text-[10px] text-amber-600 mt-2">Счёт выставляется в B2B Просчётах/Заказах — там же отмечается этап «Счёт выставлен». Заказы старше 60 дней здесь не показываются.</p>
        </div>

        {/* B2C: выставленные договоры/счета */}
        <div className="bg-white rounded-xl border border-[#e4e4e0] overflow-hidden">
          <p className="px-4 pt-4 pb-2 text-[11px] font-bold uppercase tracking-widest text-[#9a9a95]">Розница · выставленные договоры/счета ({contracts.length})</p>
          <p className="px-4 pb-2 text-[11px] text-[#9a9a95]">Оплаты розницы отслеживаются в AmoCRM (этап «Счёт выставлен — ждём оплату»). Здесь — что выставлено из системы.</p>
          {contracts.length === 0 ? (
            <p className="px-4 pb-4 text-[12px] text-[#c4c4be]">Выставленных договоров нет.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-[#9a9a95] border-b border-[#f0f0ec]">
                    <th className="px-4 py-2">Договор</th><th className="px-2 py-2">Заказчик</th>
                    <th className="px-2 py-2 text-right">Сумма</th><th className="px-2 py-2 text-right">Статус</th>
                    <th className="px-4 py-2 text-right">Дата</th>
                  </tr>
                </thead>
                <tbody>
                  {contracts.map(c => (
                    <tr key={c.id} className="border-b border-[#f8f8f7] hover:bg-[#fafaf9]">
                      <td className="px-4 py-2 font-mono font-semibold">{c.number || c.id}</td>
                      <td className="px-2 py-2">{c.customer?.full_name || c.customer?.name || '—'}</td>
                      <td className="px-2 py-2 text-right font-mono">{fmt(c.total || 0)}</td>
                      <td className="px-2 py-2 text-right">{c.status === 'signed' ? '✍️ подписан' : '📤 отправлен'}</td>
                      <td className="px-4 py-2 text-right text-[#6b6b66]">{new Date(c.created_at).toLocaleDateString('ru-RU')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
