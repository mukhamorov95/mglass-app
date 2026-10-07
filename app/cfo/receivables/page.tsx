'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { loadJson, sendOrToast, toast } from '@/lib/toast'
import { confirmDialog, promptDialog } from '@/lib/dialog'
import { BUCKETS, type Bucket, type DebtRow, type Receivables } from '@/lib/money/receivables'

// Долг клиентов: кто должен, сколько и сколько дней. Одна функция на все экраны
// (lib/money/receivables через /api/accounting/receivables): запущенные неархивные
// B2B-заказы, итог − оплачено по payments. Срок — дни с отгрузки, без отгрузки — с запуска.
// Раньше страница считала по notes.stages.invoice_sent, который с июня никто не ставит, — 0 ₽.
// B2C — договоры/счета (contracts, status sent/signed): оплата живёт в AmoCRM,
// здесь список выставленного для контроля менеджерами.

type Contract = {
  id: number
  number: string | null
  total: number | null
  status: string
  customer: { name?: string; full_name?: string } | null
  created_at: string
}

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₽'
const DD = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`
const BUCKET_CLS: Record<Bucket, string> = {
  b7: 'text-emerald-700', b14: 'text-amber-600', b30: 'text-orange-600', b99: 'text-red-600',
}

export default function ReceivablesPage() {
  const [rec, setRec] = useState<Receivables | null>(null)
  const [recErr, setRecErr] = useState<string | null>(null)
  const [contracts, setContracts] = useState<Contract[]>([])
  const [conErr, setConErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [reload, setReload] = useState(0)
  const [view, setView] = useState<'orders' | 'clients'>('orders')

  useEffect(() => {
    let alive = true
    const sb = createClient()
    Promise.all([
      loadJson<Receivables>('/api/accounting/receivables'),
      sb.from('contracts').select('id, number, total, status, customer, created_at')
        .in('status', ['sent', 'signed']).order('created_at', { ascending: false }).limit(300),
    ]).then(([r, ct]) => {
      if (!alive) return
      if (r.error !== null) setRecErr(r.error)
      else { setRec(r.data); setRecErr(null) }
      if (ct.error) setConErr(ct.error.message)
      else { setContracts((ct.data ?? []) as Contract[]); setConErr(null) }
      setLoading(false)
    })
    return () => { alive = false }
  }, [reload])

  const noInvoice = useMemo(() => (rec?.rows ?? []).filter(r => !r.invoiceNo), [rec])

  // Оплата пишется только через единый роут (Д2): notes + payments + ведомость.
  // Роут сам видит пришедшие платежи и не задваивает их.
  async function postPayment(row: DebtRow, body: { status: string; amount?: number }) {
    setBusyId(row.id)
    try {
      const r = await sendOrToast('Оплата не отмечена', `/api/b2b-orders/${row.id}/payment`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      if (!r) return
      const d = await r.json().catch(() => ({})) as { warnings?: string[] }
      if (d.warnings?.length) toast.info(d.warnings[0])
      else toast.success(body.status === 'paid' ? `Заказ ${row.ref} оплачен` : `Оплата по ${row.ref} записана`)
      setReload(n => n + 1)
    } finally { setBusyId(null) }
  }

  async function markPaid(row: DebtRow) {
    const ok = await confirmDialog({
      title: `Заказ ${row.ref} оплачен полностью?`,
      text: `Запишется платёж на остаток ${fmt(row.debt)} (итог ${fmt(row.total)}, уже пришло ${fmt(row.paid)}).`,
      confirmLabel: 'Записать оплату',
    })
    if (ok) await postPayment(row, { status: 'paid' })
  }

  async function markPartial(row: DebtRow) {
    const raw = await promptDialog({
      title: `Частичная оплата · ${row.ref}`,
      text: `Сколько клиент внёс всего (накопленная предоплата). Итог заказа ${fmt(row.total)}.`,
      label: 'Оплачено всего, ₽',
      defaultValue: row.paid > 0 ? String(Math.round(row.paid)) : '',
      confirmLabel: 'Записать',
    })
    if (raw == null) return
    const amount = Number(raw.replace(/\s/g, '').replace(',', '.'))
    if (!Number.isFinite(amount) || amount < 0) { toast.error('Сумма не записана', { detail: 'Нужно число не меньше нуля' }); return }
    if (amount >= row.total) { toast.error('Сумма не записана', { detail: `Это не частичная оплата: ${fmt(amount)} ≥ итога ${fmt(row.total)} — нажмите «✓ Оплачен»` }); return }
    await postPayment(row, { status: amount > 0 ? 'partial' : 'unpaid', amount })
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center text-[13px] text-[#8a8a85]">Загрузка…</div>

  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-20">
      <div className="bg-white border-b border-[#e4e4e0] px-5 pt-6 pb-4">
        <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">Долг клиентов</h1>
        <p className="text-[12px] text-[#9a9a95] mt-0.5">
          Запущенные B2B-заказы минус оплаты из платежей{rec ? ` · с запуска ${DD(rec.since)}.${rec.since.slice(2, 4)}` : ''}. Розница — выставленные договоры/счета.
        </p>
      </div>

      <div className="px-5 pt-4 space-y-4 max-w-[1280px]">
        {recErr && <div className="px-3 py-2 rounded-lg bg-red-50 text-red-700 text-[13px]">Долг не загрузился: {recErr}</div>}

        {rec && (
          <>
            {rec.coverage.orders > 0 && rec.coverage.withPayment < rec.coverage.orders && (
              <div className="px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-[12px] text-amber-900">
                Оплаты заведены у {rec.coverage.withPayment} из {rec.coverage.orders} заказов с {DD(rec.since)}. Пока выписка банка не
                загружается в «Бухгалтерия → Выписка», часть этой суммы — оплаты, которых нет в системе, а не долг.
              </div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div className="bg-[#111110] text-white rounded-xl p-4">
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#8a8a85]">Всего должны (B2B)</p>
                <p className="text-[20px] font-bold font-mono mt-1">{fmt(rec.total)}</p>
                <p className="text-[11px] text-[#c4c4be]">{rec.count} заказ(ов) · {rec.byClient.length} клиент(ов)</p>
              </div>
              {rec.buckets.map(b => (
                <div key={b.key} className="bg-white border border-[#e4e4e0] rounded-xl p-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#9a9a95]">{b.label}</p>
                  <p className={`text-[18px] font-bold font-mono mt-1 ${BUCKET_CLS[b.key]}`}>{fmt(b.sum)}</p>
                  <p className="text-[11px] text-[#9a9a95]">{b.count} заказ(ов)</p>
                </div>
              ))}
            </div>

            <div className="bg-white rounded-xl border border-[#e4e4e0] overflow-hidden">
              <div className="px-4 pt-4 pb-2 flex items-center justify-between gap-3">
                <p className="text-[11px] font-bold uppercase tracking-widest text-[#9a9a95]">B2B · долг по заказам</p>
                <div className="flex bg-[#f0f0ec] rounded-lg p-[3px]">
                  {([['orders', 'Заказы'], ['clients', 'Клиенты']] as const).map(([k, l]) => (
                    <button key={k} onClick={() => setView(k)}
                      className={`px-2.5 py-1 rounded-md text-[12px] font-medium ${view === k ? 'bg-white shadow-sm text-[#111110]' : 'text-[#6b6b66]'}`}>{l}</button>
                  ))}
                </div>
              </div>
              {rec.rows.length === 0 ? (
                <p className="px-4 pb-4 text-[12px] text-[#9a9a95]">Долгов нет — все запущенные заказы оплачены по платежам.</p>
              ) : view === 'clients' ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-wider text-[#9a9a95] border-b border-[#f0f0ec]">
                        <th className="px-4 py-2">Клиент</th><th className="px-2 py-2 text-right">Заказов</th>
                        <th className="px-2 py-2 text-right">Долг</th><th className="px-4 py-2 text-right">Самый старый, дней</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rec.byClient.map(c => (
                        <tr key={c.key} className="border-b border-[#f8f8f7]">
                          <td className="px-4 py-2">{c.client}</td>
                          <td className="px-2 py-2 text-right font-mono">{c.count}</td>
                          <td className="px-2 py-2 text-right font-mono font-bold">{fmt(c.debt)}</td>
                          <td className={`px-4 py-2 text-right font-mono ${BUCKET_CLS[BUCKETS.find(b => c.maxDays <= b.max)!.key]}`}>{c.maxDays}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-wider text-[#9a9a95] border-b border-[#f0f0ec]">
                        <th className="px-4 py-2">Заказ</th><th className="px-2 py-2">Клиент</th>
                        <th className="px-2 py-2 text-right">Сумма</th><th className="px-2 py-2 text-right">Оплачено</th>
                        <th className="px-2 py-2 text-right">Долг</th><th className="px-2 py-2 text-right">С какого дня</th>
                        <th className="px-2 py-2 text-right">Дней</th><th className="px-4 py-2 text-right">Действия</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rec.rows.map(r => (
                        <tr key={r.id} className="border-b border-[#f8f8f7] hover:bg-[#fafaf9]">
                          <td className="px-4 py-2 font-mono font-semibold">
                            <a href={`/b2b-deal/${r.id}`} className="hover:underline">{r.ref}</a>
                            {r.invoiceNo && <span className="ml-1 text-[10px] font-normal text-[#9a9a95]">сч. {r.invoiceNo}</span>}
                          </td>
                          <td className="px-2 py-2">{r.client}</td>
                          <td className="px-2 py-2 text-right font-mono">{fmt(r.total)}</td>
                          <td className="px-2 py-2 text-right font-mono text-[#6b6b66]">{r.paid > 0 ? fmt(r.paid) : '—'}</td>
                          <td className={`px-2 py-2 text-right font-mono font-bold ${BUCKET_CLS[r.bucket]}`}>{fmt(r.debt)}</td>
                          <td className="px-2 py-2 text-right text-[#6b6b66]">{DD(r.fromDay)} · {r.shipped ? 'отгружен' : 'запущен'}</td>
                          <td className={`px-2 py-2 text-right font-mono font-semibold ${BUCKET_CLS[r.bucket]}`}>{r.days}</td>
                          <td className="px-4 py-2 text-right whitespace-nowrap">
                            <button onClick={() => markPartial(r)} disabled={busyId === r.id}
                              className="text-[11px] border border-[#e4e4e0] rounded-lg px-2 py-1 hover:bg-[#f5f5f3] disabled:opacity-40 mr-1">Частично</button>
                            <button onClick={() => markPaid(r)} disabled={busyId === r.id}
                              className="text-[11px] font-semibold bg-emerald-600 text-white rounded-lg px-2 py-1 hover:bg-emerald-700 disabled:opacity-40">✓ Оплачен</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="bg-amber-50 rounded-xl border border-amber-200 p-4">
              <p className="text-[11px] font-bold uppercase tracking-widest text-amber-700">⚠ С долгом, а счёта в реестре нет — {noInvoice.length} заказ(ов)</p>
              {noInvoice.length === 0 ? (
                <p className="text-[12px] text-amber-700 mt-1">Таких нет — на все заказы с долгом выставлены счета.</p>
              ) : (
                <div className="mt-2 flex flex-wrap gap-2">
                  {noInvoice.map(r => (
                    <a key={r.id} href={`/b2b-deal/${r.id}`} className="text-[12px] bg-white border border-amber-200 rounded-lg px-2.5 py-1 hover:bg-amber-100">
                      {r.ref} · {r.client} · <span className="font-mono">{fmt(r.debt)}</span>
                    </a>
                  ))}
                </div>
              )}
              <p className="text-[10px] text-amber-600 mt-2">Счёт попадает в реестр при печати счёта из просчёта или «Единого счёта».</p>
            </div>
          </>
        )}

        {/* B2C: выставленные договоры/счета */}
        <div className="bg-white rounded-xl border border-[#e4e4e0] overflow-hidden">
          <p className="px-4 pt-4 pb-2 text-[11px] font-bold uppercase tracking-widest text-[#9a9a95]">Розница · выставленные договоры/счета ({contracts.length})</p>
          <p className="px-4 pb-2 text-[11px] text-[#9a9a95]">Оплаты розницы отслеживаются в AmoCRM (этап «Счёт выставлен — ждём оплату»). Здесь — что выставлено из системы.</p>
          {conErr ? (
            <p className="px-4 pb-4 text-[12px] text-red-700">Договоры не загрузились: {conErr}</p>
          ) : contracts.length === 0 ? (
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
                      <td className="px-4 py-2 text-right text-[#6b6b66]">{new Date(c.created_at).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' })}</td>
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
