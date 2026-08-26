'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

type Invoice = {
  id: number
  invoice_no: string
  payer_name: string | null
  payer_client_id: number | null
  order_ids: number[]
  amount: number
  vat: number
  status: 'issued' | 'paid' | 'cancelled'   // ручной флажок (переопределение)
  issued_at: string
  paid_at: string | null
  comment: string | null
  created_by_name: string | null
  // Производные от payments (A23): истина об оплате — здесь, не во флажке status.
  paid: number
  remainder: number
  derivedStatus: 'paid' | 'partial' | 'unpaid'
}

type Tab = 'open' | 'paid' | 'all'

const fmt = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₽`
const date = (s: string | null) => s ? new Date(s).toLocaleDateString('ru-RU') : '—'
const daysSince = (s: string) => Math.floor((Date.now() - new Date(s).getTime()) / 86_400_000)

export default function InvoicesClient() {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('open')
  const [search, setSearch] = useState('')

  useEffect(() => {
    fetch('/api/invoices')
      .then(async r => {
        const j = await r.json().catch(() => ({}))
        if (!r.ok) { setError(j.error || 'Не удалось загрузить реестр'); return }
        setInvoices((j.invoices ?? []) as Invoice[])
      })
      .catch(() => setError('Сеть недоступна'))
      .finally(() => setLoading(false))
  }, [])

  // Оплачен/не оплачен — по ПЛАТЕЖАМ (derivedStatus), не по ручному флажку.
  // Аннулированные (ручной status) в дебиторку не входят.
  const visible = useMemo(() => {
    let list = invoices
    if (tab === 'open') list = list.filter(i => i.status !== 'cancelled' && i.derivedStatus !== 'paid')
    else if (tab === 'paid') list = list.filter(i => i.derivedStatus === 'paid')
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(i =>
        (i.invoice_no ?? '').toLowerCase().includes(q) ||
        (i.payer_name ?? '').toLowerCase().includes(q) ||
        i.order_ids.some(o => String(o).includes(q))
      )
    }
    return list
  }, [invoices, tab, search])

  // Дебиторка = выставлено минус оплачено (по платежам), а не сумма счёта.
  // Просрочка — не оплачен и старше 14 дней от даты выставления.
  const debt = useMemo(() => {
    const open = invoices.filter(i => i.status !== 'cancelled' && i.derivedStatus !== 'paid')
    const overdue = open.filter(i => daysSince(i.issued_at) > 14)
    const rem = (i: Invoice) => Number(i.remainder ?? i.amount ?? 0)
    return {
      openSum: open.reduce((s, i) => s + rem(i), 0),
      openCount: open.length,
      overdueSum: overdue.reduce((s, i) => s + rem(i), 0),
      overdueCount: overdue.length,
    }
  }, [invoices])

  const notCancelled = (i: Invoice) => i.status !== 'cancelled'
  const TABS: { key: Tab; label: string; count: number }[] = [
    { key: 'open', label: 'Не оплачены', count: invoices.filter(i => notCancelled(i) && i.derivedStatus !== 'paid').length },
    { key: 'paid', label: 'Оплачены',    count: invoices.filter(i => i.derivedStatus === 'paid').length },
    { key: 'all',  label: 'Все',         count: invoices.length },
  ]

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-end justify-between gap-4 flex-wrap mb-5">
        <div>
          <h1 className="text-[24px] font-bold text-[#111110]">Счета B2B</h1>
          <p className="text-[13px] text-[#9a9a95] mt-0.5">
            Дебиторка: <span className="font-semibold text-[#111110]">{fmt(debt.openSum)}</span> по {debt.openCount} счетам
            {debt.overdueCount > 0 && (
              <> · <span className="text-red-600 font-semibold">просрочено {fmt(debt.overdueSum)}</span> ({debt.overdueCount})</>
            )}
          </p>
        </div>
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Поиск: номер, клиент, заказ…"
          className="border border-[#e4e4e0] rounded-xl px-3 py-2 text-[13px] w-64 outline-none focus:border-[#111110] transition-colors"
        />
      </div>

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`text-[12px] font-medium px-3 py-1.5 rounded-xl border transition-colors ${
              tab === t.key ? 'bg-[#111110] text-white border-[#111110]' : 'bg-white text-[#6b6b66] border-[#e4e4e0] hover:border-[#111110]'}`}>
            {t.label} <span className="opacity-60">{t.count}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-[13px] text-[#9a9a95]">Загрузка…</p>
      ) : error ? (
        <p className="text-[13px] text-red-600">{error}</p>
      ) : visible.length === 0 ? (
        <div className="bg-white border border-[#e4e4e0] rounded-2xl px-5 py-8 text-center">
          <p className="text-[14px] font-semibold text-[#111110]">Счетов пока нет</p>
          <p className="text-[12px] text-[#9a9a95] mt-1">
            Счёт попадает сюда, когда вы регистрируете его на странице счёта заказа.
          </p>
        </div>
      ) : (
        <div className="bg-white border border-[#e4e4e0] rounded-2xl overflow-hidden divide-y divide-[#f0f0ec]">
          {visible.map(inv => {
            const cancelled = inv.status === 'cancelled'
            const overdue = !cancelled && inv.derivedStatus !== 'paid' && daysSince(inv.issued_at) > 14
            // Ручной флажок разошёлся с платежами: показываем честно, не прячем.
            const manualPaid = inv.status === 'paid'
            const diverges = !cancelled && manualPaid && inv.derivedStatus !== 'paid'
            return (
              <div key={inv.id} className="px-5 py-3 flex items-center gap-4 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13px] font-bold font-mono text-[#111110]">№ {inv.invoice_no}</span>
                    <span className="text-[13px] text-[#111110] truncate">{inv.payer_name ?? '—'}</span>
                    {cancelled ? (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#f0f0ec] text-[#6b6b66]">аннулирован</span>
                    ) : inv.derivedStatus === 'paid' ? (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">оплачен</span>
                    ) : inv.derivedStatus === 'partial' ? (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">частично · остаток {fmt(inv.remainder)}</span>
                    ) : (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#f0f0ec] text-[#6b6b66]">не оплачен</span>
                    )}
                    {overdue && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-50 text-red-600">
                        просрочен {daysSince(inv.issued_at)} дн.
                      </span>
                    )}
                    {diverges && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-orange-50 text-orange-700 border border-orange-200"
                        title="Счёт отмечен оплаченным вручную, но платежи этого не подтверждают">
                        ручной флажок ≠ платежи
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-[#9a9a95] mt-0.5">
                    от {date(inv.issued_at)}
                    {inv.order_ids.length > 0 && <> · заказы: {inv.order_ids.map((o, i) => (
                      <span key={o}>
                        {i > 0 && ', '}
                        <Link href={`/b2b-quotes/${o}/invoice`} target="_blank" className="text-blue-600 hover:underline">#{o}</Link>
                      </span>
                    ))}</>}
                    {inv.created_by_name && ` · выставил: ${inv.created_by_name}`}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[14px] font-semibold text-[#111110] font-mono whitespace-nowrap">{fmt(Number(inv.amount))}</p>
                  {!cancelled && inv.paid > 0 && inv.derivedStatus !== 'paid' && (
                    <p className="text-[10px] text-[#9a9a95] whitespace-nowrap">оплачено {fmt(inv.paid)}</p>
                  )}
                  {Number(inv.vat) > 0 && <p className="text-[10px] text-[#9a9a95]">НДС {fmt(Number(inv.vat))}</p>}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
