'use client'

import { useEffect, useState } from 'react'
import type { ConsumePlan, PlanRow, DocType } from '@/lib/inventory/types'
import { UNIT_LABELS } from '@/lib/inventory/units'

// Списание материала по факту — там, где работает цех. Встраивается в
// производственный контур: <OrderConsumePanel docType="b2b_order" docId={id} />.
// Показывает только количества (себестоимость рабочему не видна), по умолчанию
// подставляет зарезервированное. На пустом складе ведёт себя тихо.
type Props = {
  docType:    DocType
  docId:      string
  onDone?:    (res: { inserted: number; released: number }) => void
  compact?:   boolean
}

const num = (s: string) => Number(String(s).replace(',', '.'))

export default function OrderConsumePanel({ docType, docId, onDone, compact }: Props) {
  const [plan, setPlan]     = useState<ConsumePlan | null>(null)
  const [actual, setActual] = useState<Record<number, string>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy]     = useState(false)
  const [error, setError]   = useState<string | null>(null)
  const [done, setDone]     = useState(false)

  useEffect(() => {
    let alive = true
    fetch(`/api/inventory/consume?type=${docType}&id=${encodeURIComponent(docId)}`)
      .then(r => r.json())
      .then(j => { if (!alive) return; if (j.error) setError(j.error); else setPlan(j.plan) })
      .catch(() => { if (alive) setError('Склад недоступен') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [docType, docId])

  // Строки, которые реально можно списать (позиция заведена на складе).
  const rows: PlanRow[] = (plan?.rows ?? []).filter(r => r.item_id !== null)

  function defaultQty(r: PlanRow): number {
    return r.reserved != null ? r.reserved : r.qty
  }
  function currentQty(r: PlanRow): number {
    const raw = actual[r.item_id as number]
    if (raw === undefined) return defaultQty(r)
    const v = num(raw)
    return Number.isNaN(v) ? 0 : v
  }

  async function submit() {
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/inventory/consume', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: docType, id: docId,
          rows: rows.map(r => ({ ...r, qty: currentQty(r) })).filter(r => r.qty > 0),
        }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error ?? 'Ошибка списания')
      if (j.alreadyConsumed) { setDone(true); setError('По этому заказу материал уже списан'); return }
      setDone(true)
      onDone?.({ inserted: j.inserted ?? 0, released: j.released ?? 0 })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <div className="text-[13px] text-[#9a9a95] py-3">Загрузка склада…</div>

  // Пустой склад / нет заведённых позиций — тихо, без таблицы «дефицитов».
  if (!rows.length) return (
    <div className="text-[13px] text-[#9a9a95] py-3">
      {plan?.already ? 'Материал по заказу уже списан.' : 'На складе нет заведённых позиций этого заказа — списывать нечего.'}
    </div>
  )

  if (done || plan?.already) return (
    <div className="text-[13px] text-emerald-700 py-3">Материал списан со склада, резерв закрыт.</div>
  )

  return (
    <div className={compact ? '' : 'border border-[#e4e4e0] rounded-lg bg-white p-3'}>
      <div className="text-[13px] font-medium text-[#111110] mb-2">Списать материал по факту</div>
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-[#9a9a95] border-b border-[#e4e4e0]">
            <th className="text-left  font-normal py-1.5">Материал</th>
            <th className="text-right font-normal py-1.5 w-24">Резерв</th>
            <th className="text-right font-normal py-1.5 w-32">Взято по факту</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const id = r.item_id as number
            const u  = r.unit ? UNIT_LABELS[r.unit] : ''
            return (
              <tr key={id} className="border-b border-[#e4e4e0] last:border-0">
                <td className="py-1.5 text-[#111110]">{r.name}</td>
                <td className="py-1.5 text-right tabular-nums text-[#9a9a95]">
                  {r.reserved != null ? `${r.reserved} ${u}` : `${r.qty} ${u}`}
                </td>
                <td className="py-1.5">
                  <div className="flex items-center justify-end gap-1">
                    <input
                      className="border border-[#e4e4e0] rounded px-2 py-1 w-20 text-right text-[13px] bg-white"
                      inputMode="decimal"
                      value={actual[id] ?? String(defaultQty(r))}
                      onChange={e => setActual(prev => ({ ...prev, [id]: e.target.value }))}
                    />
                    <span className="text-[11px] text-[#9a9a95] w-8">{u}</span>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {error && <div className="text-[13px] text-red-600 mt-2">{error}</div>}

      <div className="flex justify-end mt-3">
        <button
          className="px-3 py-1.5 text-[13px] rounded bg-[#111110] text-white hover:bg-[#2a2a28] disabled:opacity-40"
          onClick={submit} disabled={busy}>
          {busy ? 'Списываю…' : 'Списать со склада'}
        </button>
      </div>
      <div className="text-[11px] text-[#9a9a95] mt-2">
        По умолчанию — зарезервированное количество. Взяли меньше — исправьте, остаток вернётся на склад.
      </div>
    </div>
  )
}
