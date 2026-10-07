'use client'

// Б8: реестр документов. Счета B2B со статусом оплаты ПО ПЛАТЕЖАМ (lib/money/invoiceStatus)
// и отметкой УПД + договоры розницы. Ответ на вопрос бухгалтера «что выставлено и что
// закрыто» без похода в /cfo и /b2b-orders.

import { useEffect, useState } from 'react'
import { loadJson, sendOrToast } from '@/lib/toast'
import { INVOICE_STATE_LABEL, type InvoicePayState } from '@/lib/money/invoiceStatus'
import { askAndPayInvoice, askAndUnpayInvoice } from './invoicePayActions'

type Invoice = {
  id: number; no: string; payer: string | null; amount: number; vat: number
  status: string; issued_at: string; paid_at: string | null; upd_issued_at: string | null
  paid: number; remainder: number; derived: InvoicePayState
  orders: number[]; author: string | null
}
type Contract = {
  id: number; no: string; date: string; client: string | null
  amount: number; status: string; manager: string | null
}

const RUB = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₽'
const DD = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(2, 4)}`

const INV_CLS: Record<InvoicePayState | 'cancelled', string> = {
  unpaid:    'bg-amber-100 text-amber-800',
  partial:   'bg-amber-100 text-amber-800',
  paid:      'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-[#f0f0ec] text-[#6b6b66]',
}
const stateOf = (i: Invoice): InvoicePayState | 'cancelled' => i.status === 'cancelled' ? 'cancelled' : i.derived
const isOpen = (i: Invoice) => i.status !== 'cancelled' && i.derived !== 'paid'
const CON_META: Record<string, { label: string; cls: string }> = {
  draft:  { label: 'черновик', cls: 'bg-[#f0f0ec] text-[#6b6b66]' },
  sent:   { label: 'отправлен', cls: 'bg-amber-100 text-amber-800' },
  signed: { label: 'подписан',  cls: 'bg-emerald-100 text-emerald-800' },
}

export function DocumentsTab() {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [contracts, setContracts] = useState<Contract[]>([])
  const [kind, setKind] = useState<'invoices' | 'contracts'>('invoices')
  const [onlyOpen, setOnlyOpen] = useState(true)
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<number | null>(null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let alive = true
    loadJson<{ invoices: Invoice[]; contracts: Contract[] }>('/api/accounting/documents').then(res => {
      if (!alive) return
      if (res.error !== null) setLoadErr(res.error)
      else { setInvoices(res.data.invoices); setContracts(res.data.contracts); setLoadErr(null) }
      setLoading(false)
    })
    return () => { alive = false }
  }, [reload])

  async function run(id: number, action: () => Promise<boolean>) {
    setBusy(id)
    try { if (await action()) setReload(n => n + 1) } finally { setBusy(null) }
  }
  const patch = (id: number, body: Record<string, unknown>, failTitle: string) => run(id, async () =>
    !!(await sendOrToast(failTitle, '/api/accounting/documents', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...body }),
    })))

  if (loading) return <p className="text-[13px] text-[#9a9a95] py-6 text-center">Загрузка…</p>
  if (loadErr) return <p className="px-3 py-2 rounded-lg bg-red-50 text-red-700 text-[13px]">Документы не загрузились: {loadErr}</p>

  const inv = onlyOpen ? invoices.filter(isOpen) : invoices
  const con = onlyOpen ? contracts.filter(c => c.status !== 'signed') : contracts
  const unpaid = invoices.filter(isOpen).reduce((s, i) => s + i.remainder, 0)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex bg-[#f0f0ec] rounded-[10px] p-[3px]">
          {([['invoices', `Счета${invoices.length ? ` · ${invoices.length}` : ''}`], ['contracts', 'Договоры']] as const).map(([k, label]) => (
            <button key={k} onClick={() => setKind(k)}
              className={`px-3.5 py-1.5 rounded-lg text-[13px] font-medium ${kind === k ? 'bg-white shadow-sm text-[#111110]' : 'text-[#6b6b66]'}`}>
              {label}
            </button>
          ))}
        </div>
        <label className="text-[12px] text-[#6b6b66] flex items-center gap-1.5">
          <input type="checkbox" checked={onlyOpen} onChange={e => setOnlyOpen(e.target.checked)} />
          только незакрытые
        </label>
      </div>

      {kind === 'invoices' && unpaid > 0 && (
        <div className="px-3 py-2.5 rounded-lg bg-amber-50 border border-amber-200 text-[13px] text-amber-900">
          Ждут оплаты: <span className="font-mono font-semibold">{RUB(unpaid)}</span>
        </div>
      )}

      {kind === 'invoices' && (
        <div className="bg-white rounded-xl border border-[#e4e4e0] overflow-hidden">
          {inv.length === 0 && <p className="px-4 py-8 text-center text-[13px] text-[#9a9a95]">Пусто</p>}
          {inv.map(i => {
            const st = stateOf(i)
            return (
              <div key={i.id} className="px-4 py-3 border-t border-[#f0f0ee] first:border-t-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[14px] text-[#111110] font-medium truncate">
                      Счёт {i.no} · {i.payer ?? 'без плательщика'}
                    </p>
                    <p className="text-[12px] text-[#9a9a95] mt-0.5">
                      от {DD(i.issued_at)}{st === 'paid' && i.paid_at ? ` · оплачен ${DD(i.paid_at)}` : ''}
                      {i.orders.length ? ` · заказов ${i.orders.length}` : ''}
                      {i.upd_issued_at ? ` · УПД ${DD(i.upd_issued_at)}` : ''}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-[14px] font-mono font-semibold text-[#111110]">{RUB(i.amount)}</p>
                    <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${INV_CLS[st]}`}>
                      {INVOICE_STATE_LABEL[st]}{st === 'partial' ? ` · остаток ${RUB(i.remainder)}` : ''}
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 mt-2">
                  {isOpen(i) && (
                    <button onClick={() => run(i.id, () => askAndPayInvoice(i))} disabled={busy === i.id}
                      className="px-3 py-1.5 rounded-lg bg-[#111110] text-white text-[12px] font-medium disabled:opacity-50">
                      Оплачен
                    </button>
                  )}
                  {st !== 'cancelled' && i.paid > 0 && (
                    <button onClick={() => run(i.id, () => askAndUnpayInvoice(i))} disabled={busy === i.id}
                      className="px-3 py-1.5 rounded-lg border border-[#e4e4e0] text-[12px] text-[#6b6b66] disabled:opacity-50">
                      снять ручную оплату
                    </button>
                  )}
                  <button onClick={() => patch(i.id, { upd: !i.upd_issued_at }, 'Отметка УПД не сохранена')} disabled={busy === i.id}
                    className={`px-3 py-1.5 rounded-lg text-[12px] font-medium disabled:opacity-50 ${
                      i.upd_issued_at ? 'border border-[#e4e4e0] text-[#6b6b66]' : 'border border-[#111110] text-[#111110]'}`}>
                    {i.upd_issued_at ? 'снять УПД' : 'УПД выдан'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {kind === 'contracts' && (
        <div className="bg-white rounded-xl border border-[#e4e4e0] overflow-hidden">
          {con.length === 0 && <p className="px-4 py-8 text-center text-[13px] text-[#9a9a95]">Пусто</p>}
          {con.map(c => {
            const st = CON_META[c.status] ?? CON_META.draft
            return (
              <div key={c.id} className="px-4 py-3 border-t border-[#f0f0ee] first:border-t-0 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[14px] text-[#111110] font-medium truncate">
                    Договор {c.no} · {c.client ?? 'без клиента'}
                  </p>
                  <p className="text-[12px] text-[#9a9a95] mt-0.5">
                    от {DD(c.date)}{c.manager ? ` · ${c.manager}` : ''}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-[14px] font-mono font-semibold text-[#111110]">{RUB(c.amount)}</p>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${st.cls}`}>{st.label}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
