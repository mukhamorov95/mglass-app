'use client'

import { useEffect, useMemo, useState } from 'react'
import { loadJson, sendOrToast } from '@/lib/toast'
import { confirmDialog } from '@/lib/dialog'
import { INVOICE_STATE_LABEL, type InvoicePayState } from '@/lib/money/invoiceStatus'
import { askAndPayInvoice, askAndUnpayInvoice } from '@/components/accounting/invoicePayActions'

// Реестр выставленных счетов: единый счёт со страницы /b2b-orders/invoice и счета просчётов.
// Оплачен или нет — по платежам (payments), а не по флажку: «Оплачен» записывает платёж
// на остаток, и статус счёта сходится с долгом на остальных экранах.

type Invoice = {
  id: number; invoice_no: string; payer_name: string | null; order_ids: number[]
  amount: number; vat: number; status: 'issued' | 'paid' | 'cancelled'
  issued_at: string; created_by_name: string | null
  paid: number; remainder: number; derivedStatus: InvoicePayState; lastPaidAt: string | null
}

const RUB = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₽'
const DD = (d: string | null) => d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : '—'
const CLS: Record<InvoicePayState | 'cancelled', string> = {
  unpaid:    'bg-amber-100 text-amber-800',
  partial:   'bg-amber-100 text-amber-800',
  paid:      'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-[#f0f0ec] text-[#9a9a95]',
}
const stateOf = (i: Invoice): InvoicePayState | 'cancelled' => i.status === 'cancelled' ? 'cancelled' : i.derivedStatus
const isOpen = (i: Invoice) => i.status !== 'cancelled' && i.derivedStatus !== 'paid'

export default function InvoicesRegisterPage() {
  const [rows, setRows] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<number | null>(null)
  const [reload, setReload] = useState(0)
  const [filter, setFilter] = useState<'all' | 'open' | 'paid'>('all')

  useEffect(() => {
    let alive = true
    loadJson<{ invoices: Invoice[] }>('/api/invoices').then(res => {
      if (!alive) return
      if (res.error !== null) setLoadErr(res.error)
      else { setRows(res.data.invoices ?? []); setLoadErr(null) }
      setLoading(false)
    })
    return () => { alive = false }
  }, [reload])

  async function run(id: number, action: () => Promise<boolean>) {
    setBusy(id)
    try { if (await action()) setReload(n => n + 1) } finally { setBusy(null) }
  }
  const setStatus = (inv: Invoice, status: 'issued' | 'cancelled') => run(inv.id, async () => {
    if (status === 'cancelled' && !await confirmDialog({
      title: `Отменить счёт № ${inv.invoice_no}?`,
      text: 'Счёт уйдёт из дебиторки. Вернуть можно кнопкой «↩ вернуть».',
      confirmLabel: 'Отменить счёт', danger: true,
    })) return false
    return !!(await sendOrToast(status === 'cancelled' ? 'Счёт не отменён' : 'Счёт не возвращён', '/api/invoices', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: inv.id, status }),
    }))
  })

  const shown = useMemo(() => filter === 'all' ? rows
    : filter === 'open' ? rows.filter(isOpen)
    : rows.filter(r => r.status !== 'cancelled' && r.derivedStatus === 'paid'), [rows, filter])
  const totals = useMemo(() => {
    const open = rows.filter(isOpen)
    const paid = rows.filter(r => r.status !== 'cancelled' && r.derivedStatus === 'paid')
    return {
      openCount: open.length, openSum: open.reduce((s, r) => s + Number(r.remainder), 0),
      paidCount: paid.length, paidSum: paid.reduce((s, r) => s + Number(r.amount), 0),
    }
  }, [rows])

  if (loading) return <div className="min-h-screen bg-[#f5f5f3] flex items-center justify-center text-[13px] text-[#9a9a95]">Загрузка…</div>

  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-16">
      <div className="bg-white border-b border-[#e4e4e0] px-4 pt-6 pb-3 sticky top-0 z-40">
        <div className="max-w-[900px] mx-auto">
          <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">🧾 Реестр счетов</h1>
          <div className="flex gap-1 mt-3">
            {([['all', 'Все'], ['open', 'Ждут оплаты'], ['paid', 'Оплачены']] as const).map(([k, l]) => (
              <button key={k} onClick={() => setFilter(k)}
                className={`px-3.5 py-2 text-[13px] font-medium border-b-2 ${filter === k ? 'border-[#111110] text-[#111110]' : 'border-transparent text-[#9a9a95]'}`}>
                {l}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-[900px] mx-auto px-4 pt-4">
        {loadErr && <div className="mb-3 px-3 py-2 rounded-lg bg-red-50 text-red-700 text-[13px]">Счета не загрузились: {loadErr}</div>}

        {!loadErr && (
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="bg-white rounded-xl border border-[#e4e4e0] p-4">
              <p className="text-[11px] uppercase tracking-widest text-[#9a9a95]">Ждут оплаты (остаток по платежам)</p>
              <p className="text-[22px] font-bold text-amber-700">{RUB(totals.openSum)}</p>
              <p className="text-[12px] text-[#9a9a95]">{totals.openCount} счетов</p>
            </div>
            <div className="bg-white rounded-xl border border-[#e4e4e0] p-4">
              <p className="text-[11px] uppercase tracking-widest text-[#9a9a95]">Оплачено по платежам</p>
              <p className="text-[22px] font-bold text-emerald-700">{RUB(totals.paidSum)}</p>
              <p className="text-[12px] text-[#9a9a95]">{totals.paidCount} счетов</p>
            </div>
          </div>
        )}

        {!loadErr && shown.length === 0 && (
          <div className="bg-white rounded-xl border border-[#e4e4e0] p-8 text-center text-[13px] text-[#9a9a95]">
            Счетов пока нет. Единый счёт сохраняется кнопкой «Сохранить счёт» на странице счёта.
          </div>
        )}

        <div className="space-y-2">
          {shown.map(inv => {
            const st = stateOf(inv)
            return (
              <div key={inv.id} className="bg-white rounded-xl border border-[#e4e4e0] px-4 py-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[14px] font-bold font-mono text-[#111110]">№ {inv.invoice_no}</span>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${CLS[st]}`}>
                        {INVOICE_STATE_LABEL[st]}{st === 'partial' ? ` · остаток ${RUB(inv.remainder)}` : ''}
                      </span>
                      <span className="text-[12px] text-[#9a9a95]">от {DD(inv.issued_at)}</span>
                    </div>
                    <p className="text-[13px] text-[#4b4b47] mt-0.5">
                      Плательщик: <span className="font-medium text-[#111110]">{inv.payer_name || '—'}</span>
                      {' · '}{inv.order_ids.length} заказ(ов)
                      {st === 'paid' && inv.lastPaidAt ? ` · оплачен ${DD(inv.lastPaidAt)}` : ''}
                      {st === 'partial' ? ` · оплачено ${RUB(inv.paid)}` : ''}
                      {inv.created_by_name ? ` · ${inv.created_by_name}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-[16px] font-bold font-mono text-[#111110]">{RUB(Number(inv.amount))}</span>
                    <a href={`/b2b-orders/invoice?ids=${inv.order_ids.join(',')}`} target="_blank" rel="noreferrer"
                      className="text-[11px] px-2.5 py-1 rounded-lg border border-[#e4e4e0] text-[#6b6b66] hover:text-[#111110]">открыть ↗</a>
                    {isOpen(inv) && (
                      <button onClick={() => run(inv.id, () => askAndPayInvoice({ id: inv.id, no: inv.invoice_no, amount: inv.amount, paid: inv.paid, remainder: inv.remainder }))}
                        disabled={busy === inv.id}
                        className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">Оплачен</button>
                    )}
                    {st !== 'cancelled' && inv.paid > 0 && (
                      <button onClick={() => run(inv.id, () => askAndUnpayInvoice({ id: inv.id, no: inv.invoice_no }))} disabled={busy === inv.id}
                        className="text-[11px] px-2.5 py-1 rounded-lg border border-[#e4e4e0] text-[#6b6b66] disabled:opacity-50">↩ снять ручную оплату</button>
                    )}
                    {st !== 'cancelled' && (
                      <button onClick={() => setStatus(inv, 'cancelled')} disabled={busy === inv.id} title="Отменить счёт"
                        className="text-[11px] px-2 py-1 rounded-lg border border-red-200 text-red-600 disabled:opacity-50">✕</button>
                    )}
                    {st === 'cancelled' && (
                      <button onClick={() => setStatus(inv, 'issued')} disabled={busy === inv.id}
                        className="text-[11px] px-2.5 py-1 rounded-lg border border-[#e4e4e0] text-[#6b6b66] disabled:opacity-50">↩ вернуть</button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
