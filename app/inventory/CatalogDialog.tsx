'use client'

import { useEffect, useMemo, useState } from 'react'
import type { CatalogCandidate } from '@/lib/inventory/db'
import { KIND_LABELS, UNIT_LABELS } from '@/lib/inventory/units'
import { INPUT, BTN, BTN_P, api, post } from './shared'

const SOURCE_LABELS: Record<string, string> = {
  b2b_materials:        'B2B: стекло и зеркала',
  shower_catalog_items: 'Фурнитура душевых',
  materials:            'Материалы B2C',
}

type Props = { onClose: () => void; onDone: () => void }

export default function CatalogDialog({ onClose, onDone }: Props) {
  const [rows, setRows]       = useState<CatalogCandidate[]>([])
  const [picked, setPicked]   = useState<Set<string>>(new Set())
  const [search, setSearch]   = useState('')
  const [source, setSource]   = useState<string>('all')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    api<{ candidates: CatalogCandidate[] }>('/api/inventory/catalog')
      .then(r => setRows(r.candidates))
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [])

  const visible = useMemo(() => rows.filter(r =>
    !r.imported &&
    (source === 'all' || r.ref_table === source) &&
    (!search || r.name.toLowerCase().includes(search.toLowerCase()))
  ), [rows, source, search])

  const key = (r: CatalogCandidate) => `${r.ref_table}:${r.ref_id}`

  function toggle(r: CatalogCandidate) {
    setPicked(prev => {
      const next = new Set(prev)
      const k = key(r)
      if (next.has(k)) next.delete(k); else next.add(k)
      return next
    })
  }

  const allVisiblePicked = visible.length > 0 && visible.every(r => picked.has(key(r)))

  function toggleAll() {
    setPicked(prev => {
      const next = new Set(prev)
      for (const r of visible) {
        if (allVisiblePicked) next.delete(key(r))
        else next.add(key(r))
      }
      return next
    })
  }

  async function save() {
    setSaving(true); setError(null)
    const refs = [...picked].map(k => {
      const [ref_table, ...rest] = k.split(':')
      return { ref_table, ref_id: rest.join(':') }
    })
    try {
      await post('/api/inventory/catalog', { refs })
      onDone()
    } catch (e) {
      setError((e as Error).message); setSaving(false)
    }
  }

  const importedCount = rows.filter(r => r.imported).length

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-lg w-full max-w-3xl p-5 max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="text-[15px] font-medium text-[#111110]">Завести позиции из справочников</div>
        <div className="text-[12px] text-[#9a9a95] mt-1">
          Названия, размеры листов и единицы подставятся сами. Уже на складе: {importedCount}.
        </div>

        <div className="flex gap-2 mt-3">
          <input className={`${INPUT} flex-1`} placeholder="Поиск" value={search} onChange={e => setSearch(e.target.value)} />
          <select className={INPUT} value={source} onChange={e => setSource(e.target.value)}>
            <option value="all">Все справочники</option>
            {Object.entries(SOURCE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <button className={BTN} onClick={toggleAll} disabled={!visible.length}>
            {allVisiblePicked ? 'Снять' : 'Выбрать всё'} ({visible.length})
          </button>
        </div>

        <div className="mt-3 flex-1 overflow-y-auto border border-[#e4e4e0] rounded">
          {loading && <div className="p-4 text-[13px] text-[#9a9a95]">Загрузка…</div>}
          {!loading && !visible.length && (
            <div className="p-4 text-[13px] text-[#9a9a95]">Всё, что есть в справочниках, уже заведено на складе.</div>
          )}
          {visible.map(r => (
            <label key={key(r)} className="flex items-center gap-3 px-3 py-2 border-b border-[#e4e4e0] last:border-0 hover:bg-[#f5f5f3] cursor-pointer">
              <input type="checkbox" checked={picked.has(key(r))} onChange={() => toggle(r)} />
              <span className="flex-1 text-[13px] text-[#111110]">{r.name}</span>
              <span className="text-[12px] text-[#9a9a95]">{KIND_LABELS[r.kind]}</span>
              <span className="text-[12px] text-[#9a9a95] w-24 text-right">
                {UNIT_LABELS[r.unit]}{r.pack_label ? ` · ${r.pack_label} ${r.pack_size}` : ''}
              </span>
              <span className="text-[11px] text-[#9a9a95] w-40 text-right">{SOURCE_LABELS[r.ref_table]}</span>
            </label>
          ))}
        </div>

        {error && <div className="text-[13px] text-red-600 mt-3">{error}</div>}

        <div className="flex justify-between items-center mt-4">
          <span className="text-[13px] text-[#9a9a95]">Выбрано: {picked.size}</span>
          <div className="flex gap-2">
            <button className={BTN} onClick={onClose}>Отмена</button>
            <button className={BTN_P} onClick={save} disabled={saving || !picked.size}>
              {saving ? 'Завожу…' : `Завести ${picked.size}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
