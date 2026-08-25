'use client'

// Б8: реестр документов. Счета B2B с отметками «оплачен» и «УПД выдан» +
// договоры розницы. Ответ на вопрос бухгалтера «что выставлено и что закрыто»
// без похода в /cfo и /b2b-orders.

import { useCallback, useEffect, useState } from 'react'

type Invoice = {
  id: number; no: string; payer: string | null; amount: number; vat: number
  status: string; issued_at: string; paid_at: string | null; upd_issued_at: string | null
  orders: number; author: string | null
}
type Contract = {
  id: number; no: string; date: string; client: string | null
  amount: number; status: string; manager: string | null
}

const RUB = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₽'
const DD = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(2, 4)}`

const INV_META: Record<string, { label: string; cls: string }> = {
  issued:    { label: 'ждёт оплаты', cls: 'bg-amber-100 text-amber-800' },
  paid:      { label: 'оплачен',     cls: 'bg-emerald-100 text-emerald-800' },
  cancelled: { label: 'отменён',     cls: 'bg-[#f0f0ec] text-[#6b6b66]' },
}
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
  const [busy, setBusy] = useState<number | null>(null)

  const load = useCallback(async () => {
    const r = await fetch('/api/accounting/documents')
    if (r.ok) {
      const j = await r.json()
      setInvoices(j.invoices as Invoice[])
      setContracts(j.contracts as Contract[])
    }
    setLoading(false)
  }, [])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [load])

  async function patch(id: number, body: Record<string, unknown>) {
    setBusy(id)
    await fetch('/api/accounting/documents', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...body }),
    })
    await load()
    setBusy(null)
  }

  if (loading) return <p className="text-[13px] text-[#9a9a95] py-6 text-center">Загрузка…</p>

  const inv = onlyOpen ? invoices.filter(i => i.status === 'issued') : invoices
  const con = onlyOpen ? contracts.filter(c => c.status !== 'signed') : contracts
  const unpaid = invoices.filter(i => i.status === 'issued').reduce((s, i) => s + i.amount, 0)

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
            const st = INV_META[i.status] ?? INV_META.issued
            return (
              <div key={i.id} className="px-4 py-3 border-t border-[#f0f0ee] first:border-t-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[14px] text-[#111110] font-medium truncate">
                      Счёт {i.no} · {i.payer ?? 'без плательщика'}
                    </p>
                    <p className="text-[12px] text-[#9a9a95] mt-0.5">
                      от {DD(i.issued_at)}{i.paid_at ? ` · оплачен ${DD(i.paid_at)}` : ''}
                      {i.orders ? ` · заказов ${i.orders}` : ''}
                      {i.upd_issued_at ? ` · УПД ${DD(i.upd_issued_at)}` : ''}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-[14px] font-mono font-semibold text-[#111110]">{RUB(i.amount)}</p>
                    <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${st.cls}`}>{st.label}</span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 mt-2">
                  {i.status !== 'paid' && (
                    <button onClick={() => patch(i.id, { status: 'paid' })} disabled={busy === i.id}
                      className="px-3 py-1.5 rounded-lg bg-[#111110] text-white text-[12px] font-medium disabled:opacity-50">
                      Оплачен
                    </button>
                  )}
                  {i.status === 'paid' && (
                    <button onClick={() => patch(i.id, { status: 'issued' })} disabled={busy === i.id}
                      className="px-3 py-1.5 rounded-lg border border-[#e4e4e0] text-[12px] text-[#6b6b66] disabled:opacity-50">
                      снять оплату
                    </button>
                  )}
                  <button onClick={() => patch(i.id, { upd: !i.upd_issued_at })} disabled={busy === i.id}
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
