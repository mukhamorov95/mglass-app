'use client'

import { useEffect, useState } from 'react'
import type { MoveRow } from '@/lib/inventory/db'
import type { MoveReason } from '@/lib/inventory/types'
import { REASON_LABELS, UNIT_LABELS } from '@/lib/inventory/units'
import { INPUT, api, dateTime, money } from './shared'

const DOC_LABELS: Record<string, string> = {
  purchase_order: 'закупка', b2b_order: 'B2B-заказ', order: 'заказ', shop_request: 'заявка',
}

export default function MovesTab({ canSeeCost }: { canSeeCost: boolean }) {
  const [moves, setMoves]     = useState<MoveRow[]>([])
  const [reason, setReason]   = useState<MoveReason | 'all'>('all')
  const [search, setSearch]   = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    api<{ moves: MoveRow[] }>(`/api/inventory/moves?limit=300${reason === 'all' ? '' : `&reason=${reason}`}`)
      .then(r => { if (alive) setMoves(r.moves) })
      .catch(() => { if (alive) setMoves([]) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [reason])

  const visible = moves.filter(m => !search || m.item_name.toLowerCase().includes(search.toLowerCase()))

  return (
    <div>
      <div className="flex gap-2 mb-3">
        <input className={`${INPUT} flex-1 max-w-xs`} placeholder="Поиск по позиции" value={search} onChange={e => setSearch(e.target.value)} />
        <select className={INPUT} value={reason}
          onChange={e => { setLoading(true); setReason(e.target.value as MoveReason | 'all') }}>
          <option value="all">Все основания</option>
          {Object.entries(REASON_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>

      {loading && <div className="text-[13px] text-[#9a9a95] py-6">Загрузка…</div>}
      {!loading && !visible.length && <div className="text-[13px] text-[#9a9a95] py-6">Движений пока нет.</div>}

      {!!visible.length && (
        <div className="overflow-x-auto border border-[#e4e4e0] rounded-lg bg-white">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-[#9a9a95] border-b border-[#e4e4e0]">
                <th className="text-left  font-normal px-3 py-2 w-36">Когда</th>
                <th className="text-left  font-normal px-3 py-2">Позиция</th>
                <th className="text-right font-normal px-3 py-2 w-32">Движение</th>
                <th className="text-left  font-normal px-3 py-2 w-44">Основание</th>
                {canSeeCost && <th className="text-right font-normal px-3 py-2 w-28">Цена</th>}
                <th className="text-left  font-normal px-3 py-2 w-40">Кто</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(m => (
                <tr key={m.id} className="border-b border-[#e4e4e0] last:border-0 hover:bg-[#f5f5f3]">
                  <td className="px-3 py-2 text-[#9a9a95] whitespace-nowrap">{dateTime(m.created_at)}</td>
                  <td className="px-3 py-2 text-[#111110]">
                    {m.item_name}
                    {m.note && <div className="text-[11px] text-[#9a9a95]">{m.note}</div>}
                  </td>
                  <td className={`px-3 py-2 text-right tabular-nums ${m.qty > 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                    {m.qty > 0 ? '+' : ''}{m.qty} {UNIT_LABELS[m.item_unit]}
                    {m.pack_qty ? <div className="text-[11px] text-[#9a9a95]">{m.pack_qty} тара</div> : null}
                  </td>
                  <td className="px-3 py-2 text-[#9a9a95]">
                    {REASON_LABELS[m.reason]}
                    {m.origin === 'plan' && (
                      <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">по плану</span>
                    )}
                    {m.doc_type && <span className="ml-1 text-[11px]">({DOC_LABELS[m.doc_type] ?? m.doc_type} {m.doc_id})</span>}
                  </td>
                  {canSeeCost && (
                    <td className="px-3 py-2 text-right tabular-nums text-[#9a9a95]">
                      {m.unit_cost > 0 ? money(m.unit_cost) : '—'}
                    </td>
                  )}
                  <td className="px-3 py-2 text-[#9a9a95]">{m.created_by_name || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
