'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'

// Реестр выставленных счетов: единый счёт, сохранённый со страницы /b2b-orders/invoice.
// Незакрытые (issued) = дебиторка по счетам. Здесь их помечают оплаченными.

type Invoice = {
  id: number; invoice_no: string; payer_name: string | null; order_ids: number[]
  amount: number; vat: number; status: 'issued' | 'paid' | 'cancelled'
  issued_at: string; paid_at: string | null; created_by_name: string | null
}

const RUB = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₽'
const DD = (d: string | null) => d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : '—'
const STATUS: Record<string, { label: string; cls: string }> = {
  issued:    { label: 'выставлен', cls: 'bg-amber-100 text-amber-800' },
  paid:      { label: 'оплачен',   cls: 'bg-emerald-100 text-emerald-800' },
  cancelled: { label: 'отменён',   cls: 'bg-[#f0f0ec] text-[#9a9a95]' },
}

export default function InvoicesRegisterPage() {
  const [rows, setRows] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'issued' | 'paid'>('all')

  const load = useCallback(async () => {
    const r = await fetch('/api/invoices')
    const d = await r.json().catch(() => ({ invoices: [] }))
    setRows((d.invoices ?? []) as Invoice[])
    setLoading(false)
  }, [])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [load])

  async function setStatus(id: number, status: string) {
    setRows(prev => prev.map(x => x.id === id ? { ...x, status: status as Invoice['status'], paid_at: status === 'paid' ? new Date().toLocaleDateString('sv-SE') : null } : x))
    await fetch('/api/invoices', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status }) })
    await load()
  }

  const shown = useMemo(() => filter === 'all' ? rows : rows.filter(r => r.status === filter), [rows, filter])
  const totals = useMemo(() => {
    const issued = rows.filter(r => r.status === 'issued')
    const paid = rows.filter(r => r.status === 'paid')
    return {
      issuedCount: issued.length, issuedSum: issued.reduce((s, r) => s + Number(r.amount), 0),
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
            {([['all', 'Все'], ['issued', 'Ждут оплаты'], ['paid', 'Оплачены']] as const).map(([k, l]) => (
              <button key={k} onClick={() => setFilter(k)}
                className={`px-3.5 py-2 text-[13px] font-medium border-b-2 ${filter === k ? 'border-[#111110] text-[#111110]' : 'border-transparent text-[#9a9a95]'}`}>
                {l}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-[900px] mx-auto px-4 pt-4">
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="bg-white rounded-xl border border-[#e4e4e0] p-4">
            <p className="text-[11px] uppercase tracking-widest text-[#9a9a95]">Ждут оплаты (дебиторка)</p>
            <p className="text-[22px] font-bold text-amber-700">{RUB(totals.issuedSum)}</p>
            <p className="text-[12px] text-[#9a9a95]">{totals.issuedCount} счетов</p>
          </div>
          <div className="bg-white rounded-xl border border-[#e4e4e0] p-4">
            <p className="text-[11px] uppercase tracking-widest text-[#9a9a95]">Оплачено</p>
            <p className="text-[22px] font-bold text-emerald-700">{RUB(totals.paidSum)}</p>
            <p className="text-[12px] text-[#9a9a95]">{totals.paidCount} счетов</p>
          </div>
        </div>

        {shown.length === 0 && (
          <div className="bg-white rounded-xl border border-[#e4e4e0] p-8 text-center text-[13px] text-[#9a9a95]">
            Счетов пока нет. Единый счёт сохраняется кнопкой «Сохранить счёт» на странице счёта.
          </div>
        )}

        <div className="space-y-2">
          {shown.map(inv => (
            <div key={inv.id} className="bg-white rounded-xl border border-[#e4e4e0] px-4 py-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[14px] font-bold font-mono text-[#111110]">№ {inv.invoice_no}</span>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS[inv.status].cls}`}>{STATUS[inv.status].label}</span>
                    <span className="text-[12px] text-[#9a9a95]">от {DD(inv.issued_at)}</span>
                  </div>
                  <p className="text-[13px] text-[#4b4b47] mt-0.5">
                    Плательщик: <span className="font-medium text-[#111110]">{inv.payer_name || '—'}</span>
                    {' · '}{inv.order_ids.length} заказ(ов){inv.paid_at ? ` · оплачен ${DD(inv.paid_at)}` : ''}
                    {inv.created_by_name ? ` · ${inv.created_by_name}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-[16px] font-bold font-mono text-[#111110]">{RUB(Number(inv.amount))}</span>
                  <a href={`/b2b-orders/invoice?ids=${inv.order_ids.join(',')}`} target="_blank" rel="noreferrer"
                    className="text-[11px] px-2.5 py-1 rounded-lg border border-[#e4e4e0] text-[#6b6b66] hover:text-[#111110]">открыть ↗</a>
                  {inv.status === 'issued' && (
                    <button onClick={() => setStatus(inv.id, 'paid')} className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700">Оплачен</button>
                  )}
                  {inv.status === 'paid' && (
                    <button onClick={() => setStatus(inv.id, 'issued')} className="text-[11px] px-2.5 py-1 rounded-lg border border-[#e4e4e0] text-[#6b6b66]">↩ вернуть</button>
                  )}
                  {inv.status !== 'cancelled' && (
                    <button onClick={() => setStatus(inv.id, 'cancelled')} className="text-[11px] px-2 py-1 rounded-lg border border-red-200 text-red-600">✕</button>
                  )}
                  {inv.status === 'cancelled' && (
                    <button onClick={() => setStatus(inv.id, 'issued')} className="text-[11px] px-2.5 py-1 rounded-lg border border-[#e4e4e0] text-[#6b6b66]">↩ вернуть</button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
