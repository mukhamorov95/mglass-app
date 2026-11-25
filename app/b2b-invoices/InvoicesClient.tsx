'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { matchScore } from '@/lib/search/translitMatch'
import { confirmDialog } from '@/lib/dialog'
import { toast } from '@/lib/toast'

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
  payment_doc_path?: string | null
  payment_doc_at?: string | null
  payment_doc_by?: string | null
  archived_at?: string | null
  archived_by?: string | null
  // Производные от payments (A23): истина об оплате — здесь, не во флажке status.
  paid: number
  remainder: number
  derivedStatus: 'paid' | 'partial' | 'unpaid'
}

type Tab = 'open' | 'paid' | 'all' | 'archive'

const fmt = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₽`
const date = (s: string | null) => s ? new Date(s).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' }) : '—'
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
  const [busy, setBusy] = useState<number | null>(null)
  async function setArchived(inv: Invoice, archive: boolean) {
    const ok = await confirmDialog(archive
      ? { title: `Убрать счёт № ${inv.invoice_no} в архив?`, text: `${inv.order_ids.length} заказов, ${fmt(Number(inv.amount))}. Счёт перестанет считаться долгом и пропадёт из кабинета клиента. Он останется во вкладке «Архив», вернуть можно.`, confirmLabel: 'В архив' }
      : { title: `Вернуть счёт № ${inv.invoice_no} из архива?`, text: 'Он снова станет действующим и появится в кабинете клиента.', confirmLabel: 'Вернуть' })
    if (!ok) return
    setBusy(inv.id)
    try {
      const r = await fetch('/api/invoices', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: inv.id, archive }) })
      const d = await r.json().catch(() => ({})) as { error?: string; archived_at?: string | null; archived_by?: string | null }
      if (!r.ok) { toast.error(archive ? 'Не убран в архив' : 'Не возвращён', { detail: d.error ?? `Ошибка ${r.status}` }); return }
      setInvoices(prev => prev.map(i => i.id === inv.id ? { ...i, status: archive ? 'cancelled' : 'issued', archived_at: d.archived_at ?? null, archived_by: d.archived_by ?? null } : i))
      toast.success(archive ? `Счёт № ${inv.invoice_no} — в архиве` : `Счёт № ${inv.invoice_no} снова действует`, { detail: archive ? 'Найти его можно во вкладке «Архив».' : undefined })
    } catch { toast.error('Сеть недоступна') }
    finally { setBusy(null) }
  }

  const visible = useMemo(() => {
    let list = tab === 'archive' ? invoices.filter(i => i.archived_at) : invoices.filter(i => !i.archived_at)
    if (tab === 'open') list = list.filter(i => i.status !== 'cancelled' && i.derivedStatus !== 'paid')
    else if (tab === 'paid') list = list.filter(i => i.derivedStatus === 'paid')
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(i =>
        (i.invoice_no ?? '').toLowerCase().includes(q) ||
        (i.payer_name ?? '').toLowerCase().includes(q) ||
        i.order_ids.some(o => String(o).includes(q)) ||
        // Плательщик — в обоих алфавитах (О8): «шо» → Shower Glass.
        (/\p{L}/u.test(q) && matchScore(q, [i.payer_name]) > 0)
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
    { key: 'all',  label: 'Все',         count: invoices.filter(i => !i.archived_at).length },
    { key: 'archive', label: 'Архив',   count: invoices.filter(i => i.archived_at).length },
  ]

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-end justify-between gap-4 flex-wrap mb-5">
        <div>
          <h1 className="text-[24px] font-bold text-[#111110]">Счета B2B</h1>
          <p className="text-[13px] text-[#9a9a95] mt-0.5">
            {/* Шапка всегда про неоплаченные счета, а список ниже — про выбранную
                вкладку: без этой оговорки во вкладке «Оплачены» цифра и строки были
                про разное (аудит итогов, A10). */}
            Дебиторка (неоплаченные счета): <span className="font-semibold text-[#111110]">{fmt(debt.openSum)}</span> по {debt.openCount} счетам
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
                    {inv.archived_at ? (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#f0f0ec] text-[#6b6b66]">в архиве · {date(inv.archived_at)}{inv.archived_by ? ` · ${inv.archived_by}` : ''}</span>
                    ) : cancelled ? (
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
                    {!cancelled && inv.payment_doc_path && inv.derivedStatus !== 'paid' && (
                      <a href={`/api/partner/invoices/${inv.id}/payment-doc`} target="_blank" rel="noreferrer"
                        className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 hover:underline"
                        title={`Приложил ${inv.payment_doc_by ?? 'клиент'}. Оплатой счёт сделает поступление денег по выписке.`}>
                        📎 платёжка клиента {date(inv.payment_doc_at ?? null)}
                      </a>
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
                  {inv.order_ids.length > 1 && (inv.archived_at || !cancelled) && (
                    <button onClick={() => setArchived(inv, !inv.archived_at)} disabled={busy === inv.id}
                      className="mt-1 text-[11px] text-[#6b6b66] hover:text-[#111110] underline disabled:opacity-40">
                      {busy === inv.id ? '…' : inv.archived_at ? 'Вернуть из архива' : 'В архив'}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
