'use client'

// Вкладка «Акт сверки»: период, расчёт, сохранение в историю. Загрузка своя: сбой отгрузок её не трогает, и наоборот.

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { presetPeriod, type PresetId } from '@/lib/b2b/clientReport'
import { confirmDialog } from '@/lib/dialog'
import { loadJson, sendOrToast, toast } from '@/lib/toast'
import { debtText, type ReconDoc } from '@/lib/production/clientReconciliation'
import ReconciliationDoc, { fmtMoney } from './ReconciliationDoc'
import { fmtDay } from './types'

const API = '/api/production/client-reconciliation'
const PRESETS: { id: PresetId; label: string }[] = [
  { id: 'month', label: 'Этот месяц' }, { id: 'prev_month', label: 'Прошлый месяц' }, { id: 'quarter', label: 'Квартал' }, { id: 'year', label: 'Год' },
]
type HistoryRow = { id: number; date_from: string; date_to: string; created_at: string; created_by_name: string | null; closing_items: string | null; closing_whole: string | null }
type Data = { today: string; doc: ReconDoc; history: HistoryRow[] }

export default function Reconciliation({ today, client }: { today: string; client: string }) {
  const [period, setPeriod] = useState(() => presetPeriod('month', today))
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    const r = await loadJson<Data>(`${API}?from=${period.from}&to=${period.to}`)
    if (r.error !== null) { setError(r.error); return }
    setData(r.data)
  }, [period])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load() }, [load])

  const ready = data && data.doc.from === period.from && data.doc.to === period.to

  async function save() {
    setBusy(true)
    const res = await sendOrToast('Акт не сохранён', API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save', from: period.from, to: period.to }) })
    setBusy(false)
    if (!res) return
    const saved = await res.json() as { id: number }
    toast.success(`Акт № ${saved.id} сохранён`, { detail: 'Он в истории актов на этой вкладке. Оттуда его можно открыть и сохранить в PDF.' })
    await load()
  }

  async function remove(h: HistoryRow) {
    const yes = await confirmDialog({ title: `Удалить акт № ${h.id}?`, text: `За период ${fmtDay(h.date_from)} — ${fmtDay(h.date_to)}. Заказы и оплаты не изменятся, удалится только сохранённый документ.`, confirmLabel: 'Удалить', danger: true })
    if (!yes) return
    setBusy(true)
    const res = await sendOrToast('Акт не удалён', API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', id: h.id }) })
    setBusy(false)
    if (!res) return
    toast.success(`Акт № ${h.id} удалён`)
    await load()
  }

  return (
    <section className="space-y-4">
      <div className="rounded-lg border border-[#e4e4e0] bg-white p-3 space-y-2">
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map(p => {
            const v = presetPeriod(p.id, today)
            const on = v.from === period.from && v.to === period.to
            return <button key={p.id} onClick={() => setPeriod(v)} aria-pressed={on} className={`h-9 px-3 rounded-lg border text-[13px] ${on ? 'bg-[#111110] text-white border-[#111110]' : 'bg-white text-[#4b4b47] border-[#e4e4e0]'}`}>{p.label}</button>
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-[#4b4b47]">
          <label className="flex items-center gap-1.5">С <input type="date" value={period.from} max={period.to} onChange={e => e.target.value && setPeriod(p => ({ ...p, from: e.target.value }))} className="h-9 rounded-lg border border-[#e4e4e0] px-2" /></label>
          <label className="flex items-center gap-1.5">по <input type="date" value={period.to} min={period.from} onChange={e => e.target.value && setPeriod(p => ({ ...p, to: e.target.value }))} className="h-9 rounded-lg border border-[#e4e4e0] px-2" /></label>
          <button disabled={busy || !ready} onClick={() => void save()} className="h-9 px-4 rounded-lg bg-[#111110] text-white text-[13px] font-medium disabled:opacity-50 sm:ml-auto">Сохранить акт в историю</button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
          Не удалось посчитать: {error}. <button onClick={() => void load()} className="underline font-medium">Повторить</button>
        </div>
      )}
      {!ready && !error && <p className="text-[13px] text-[#9a9a95]">Считаю…</p>}

      {data && data.history.length > 0 && (
        <div className="space-y-1.5">
          <h3 className="text-[14px] font-semibold text-[#111110]">История актов · {data.history.length}</h3>
          {data.history.map(h => (
            <div key={h.id} className="rounded-lg border border-[#e4e4e0] bg-white px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
              <Link href={`/production-app/shower-glass/reconciliation/${h.id}`} className="font-medium text-[#111110] underline">№ {h.id}, {fmtDay(h.date_from)} — {fmtDay(h.date_to)}</Link>
              {h.closing_items != null && <span className="text-[#4b4b47]">{debtText(Number(h.closing_items), client)} {fmtMoney(Math.abs(Number(h.closing_items)))} с частями</span>}
              <span className="text-[12px] text-[#9a9a95]">{fmtDay(h.created_at.slice(0, 10))}{h.created_by_name ? `, ${h.created_by_name}` : ''}</span>
              <button disabled={busy} onClick={() => void remove(h)} className="ml-auto text-[12px] text-red-600">Удалить</button>
            </div>
          ))}
        </div>
      )}

      {ready && (
        <div className="rounded-lg border border-[#e4e4e0] bg-white p-4">
          <ReconciliationDoc doc={data.doc} caption="Расчёт на сейчас, пока не сохранён." />
        </div>
      )}
    </section>
  )
}
