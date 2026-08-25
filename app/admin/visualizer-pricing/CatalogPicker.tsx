'use client'

import { useEffect, useState } from 'react'

// ── Пикер из справочника поставщиков ──────────────────────────────
type PickRow = { id: number; supplier: string; category: string; name: string; color: string; cost_price: number; retail_price: number; is_favorite: boolean }
type PickSource = { supplier: string; title: string; discount_percent: number }
type CompareRow = { id: number; supplier: string; name: string; color: string; cost_price: number }

export function CatalogPicker({ onPick, onClose }: { onPick: (id: number) => void; onClose: () => void }) {
  const [supplier, setSupplier] = useState('all')
  const [q, setQ] = useState('')
  const [qd, setQd] = useState('')
  const [favOnly, setFavOnly] = useState(false)
  const [rows, setRows] = useState<PickRow[]>([])
  const [sources, setSources] = useState<PickSource[]>([])
  const [total, setTotal] = useState(0)
  const [favTotal, setFavTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [compareId, setCompareId] = useState<number | null>(null)
  const [compare, setCompare] = useState<{ cheapest: number | null; matches: CompareRow[] } | null>(null)

  useEffect(() => { const t = setTimeout(() => setQd(q), 300); return () => clearTimeout(t) }, [q])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- загрузка позиций справочника в пикер
    setLoading(true)
    const p = new URLSearchParams({ supplier, q: qd, page: '0' })
    if (favOnly) p.set('favorites', '1')
    fetch(`/api/admin/supplier-catalog?${p}`).then(r => r.ok ? r.json() : null).then(d => {
      if (d) { setRows(d.rows); setSources(d.sources); setTotal(d.total); setFavTotal(d.favTotal ?? 0) }
    }).finally(() => setLoading(false))
  }, [supplier, qd, favOnly])

  const title = (s: string) => sources.find(x => x.supplier === s)?.title ?? s

  const toggleFav = (r: PickRow) => {
    const next = !r.is_favorite
    setRows(rs => rs.map(x => x.id === r.id ? { ...x, is_favorite: next } : x))
    setFavTotal(t => t + (next ? 1 : -1))
    fetch('/api/admin/supplier-catalog/favorite', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: r.id, favorite: next }),
    }).catch(() => {})
  }
  const openCompare = (id: number) => {
    if (compareId === id) { setCompareId(null); setCompare(null); return }
    setCompareId(id); setCompare(null)
    fetch(`/api/admin/supplier-catalog/compare?id=${id}`).then(r => r.ok ? r.json() : null).then(d => {
      if (d) setCompare({ cheapest: d.cheapest, matches: d.matches })
    })
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 pt-16" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-[720px] max-h-[80vh] flex flex-col shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-[#e4e4e0]">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[15px] font-semibold text-[#111110]">Из справочника поставщиков</p>
            <button onClick={onClose} className="text-[#9a9a95] hover:text-[#111110] text-[18px] leading-none">×</button>
          </div>
          <div className="flex flex-wrap gap-1.5 mb-2">
            <button onClick={() => setSupplier('all')} className={`px-3 py-1 rounded-md text-[12px] font-medium border ${supplier === 'all' ? 'bg-[#111110] text-white border-[#111110]' : 'bg-white text-[#4b4b47] border-[#e4e4e0]'}`}>Все</button>
            {sources.map(s => (
              <button key={s.supplier} onClick={() => setSupplier(s.supplier)} className={`px-3 py-1 rounded-md text-[12px] font-medium border ${supplier === s.supplier ? 'bg-[#111110] text-white border-[#111110]' : 'bg-white text-[#4b4b47] border-[#e4e4e0]'}`}>{s.title} −{s.discount_percent}%</button>
            ))}
            <button onClick={() => setFavOnly(v => !v)} className={`px-3 py-1 rounded-md text-[12px] font-medium border ml-auto ${favOnly ? 'bg-[#a06a00] text-white border-[#a06a00]' : 'bg-white text-[#a06a00] border-[#e4d9c0]'}`}>★ Наши позиции{favTotal ? ` (${favTotal})` : ''}</button>
          </div>
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Поиск: название или артикул (напр. «петля 180», «труба 30х10»)…"
            className="w-full text-[13px] border border-[#e4e4e0] rounded-lg px-3 py-2 focus:border-[#111110] outline-none" />
        </div>
        <div className="overflow-auto p-2">
          {loading && <p className="text-[13px] text-[#9a9a95] px-2 py-3">Загрузка…</p>}
          {!loading && rows.length === 0 && <p className="text-[13px] text-[#9a9a95] px-2 py-3">{favOnly ? 'В «наших позициях» пусто — отметь нужные звёздочкой' : 'Ничего не найдено'}</p>}
          {rows.map(r => (
            <div key={r.id}>
              <div className="w-full px-2 py-2 rounded-lg hover:bg-[#f5f5f3] flex items-center gap-2">
                <button onClick={() => toggleFav(r)} title={r.is_favorite ? 'Убрать из наших позиций' : 'Отметить как нашу позицию'}
                  className={`text-[15px] leading-none shrink-0 ${r.is_favorite ? 'text-[#e0a200]' : 'text-[#d0d0cc] hover:text-[#e0a200]'}`}>{r.is_favorite ? '★' : '☆'}</button>
                <button onClick={() => onPick(r.id)} className="flex-1 min-w-0 text-left">
                  <span className="block text-[13px] text-[#111110] truncate">{r.name}</span>
                  <span className="block text-[11px] text-[#9a9a95]">{title(r.supplier)} · {r.color || '—'}</span>
                </button>
                <button onClick={() => openCompare(r.id)} title="Сравнить у поставщиков"
                  className={`text-[13px] leading-none shrink-0 px-1 ${compareId === r.id ? 'text-[#111110]' : 'text-[#9a9a95] hover:text-[#111110]'}`}>⇄</button>
                <span className="font-mono text-[13px] font-semibold text-[#111110] shrink-0 w-[76px] text-right">{Math.round(r.cost_price).toLocaleString('ru-RU')} ₽</span>
              </div>
              {compareId === r.id && (
                <div className="ml-7 mr-1 mb-1.5 rounded-lg bg-[#faf9f6] border border-[#eeece5] p-2">
                  {!compare && <p className="text-[11px] text-[#9a9a95] px-1 py-1">Ищем у других поставщиков…</p>}
                  {compare && compare.matches.length === 0 && <p className="text-[11px] text-[#9a9a95] px-1 py-1">Похожих позиций у других поставщиков нет</p>}
                  {compare && compare.matches.map(m => {
                    const isCheapest = m.cost_price === compare.cheapest
                    return (
                      <button key={m.id} onClick={() => onPick(m.id)}
                        className="w-full text-left flex items-center gap-2 px-2 py-1 rounded-md hover:bg-white">
                        <span className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded ${isCheapest ? 'bg-[#256029] text-white' : 'bg-[#eceae2] text-[#6b6b63]'}`}>{title(m.supplier)}</span>
                        <span className="flex-1 min-w-0 text-[11px] text-[#6b6b63] truncate">{m.color || '—'}</span>
                        {isCheapest && <span className="text-[10px] text-[#256029] font-semibold shrink-0">дешевле</span>}
                        <span className="font-mono text-[12px] font-semibold text-[#111110] shrink-0">{Math.round(m.cost_price).toLocaleString('ru-RU')} ₽</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          ))}
          {!loading && total > rows.length && <p className="text-[11px] text-[#9a9a95] px-3 py-2">Показаны первые {rows.length} из {total} — уточни поиск</p>}
        </div>
        <div className="p-3 border-t border-[#e4e4e0] text-[11px] text-[#9a9a95]">
          ★ — «наши позиции» (что реально закупаем), всегда наверху. ⇄ — сравнить цену у поставщиков. Выбор заполнит себестоимость по всем цветам, скидка учтена.
        </div>
      </div>
    </div>
  )
}
