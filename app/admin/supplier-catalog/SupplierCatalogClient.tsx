'use client'

import { useCallback, useEffect, useState } from 'react'

type Source = { supplier: string; title: string; discount_percent: number; site_url: string }
type Cat = { category: string; cnt: number }
type Row = {
  id: number; category: string; article: string; name: string; color: string; unit: string
  retail_price: number; discount_percent: number; cost_price: number; url: string
}
type Resp = { sources: Source[]; categories: Cat[]; rows: Row[]; total: number; page: number; pageSize: number }

const rub = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₽`

export function SupplierCatalogClient() {
  const [supplier, setSupplier] = useState('vetro')
  const [category, setCategory] = useState('')
  const [q, setQ] = useState('')
  const [qDebounced, setQDebounced] = useState('')
  const [page, setPage] = useState(0)
  const [data, setData] = useState<Resp | null>(null)
  const [loading, setLoading] = useState(false)
  const [discEdit, setDiscEdit] = useState<string>('')
  const [savingDisc, setSavingDisc] = useState(false)

  useEffect(() => { const t = setTimeout(() => setQDebounced(q), 300); return () => clearTimeout(t) }, [q])
  useEffect(() => { setPage(0) }, [supplier, category, qDebounced])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const p = new URLSearchParams({ supplier, category, q: qDebounced, page: String(page) })
      const res = await fetch(`/api/admin/supplier-catalog?${p}`)
      if (res.ok) setData(await res.json())
    } finally { setLoading(false) }
  }, [supplier, category, qDebounced, page])
  useEffect(() => { load() }, [load])

  const src = data?.sources.find(s => s.supplier === supplier)
  useEffect(() => { if (src) setDiscEdit(String(src.discount_percent)) }, [src?.supplier, src?.discount_percent])

  async function saveDiscount() {
    const v = Number(discEdit)
    if (!Number.isFinite(v)) return
    setSavingDisc(true)
    try {
      const res = await fetch('/api/admin/supplier-catalog', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ supplier, discount_percent: v }),
      })
      if (res.ok) await load()
    } finally { setSavingDisc(false) }
  }

  const totalPages = data ? Math.ceil(data.total / data.pageSize) : 0

  return (
    <div className="max-w-[1240px] mx-auto px-6 py-6">
      <div className="mb-4">
        <h1 className="text-[20px] font-semibold text-[#111110] tracking-tight">Справочник поставщиков</h1>
        <p className="text-[13px] text-[#8a8a85] mt-0.5">Общий прайс с разных поставщиков. Скидка → себестоимость. Единый источник цен для расчётов.</p>
      </div>

      {/* Поставщики + скидка */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {data?.sources.map(s => (
          <button key={s.supplier} onClick={() => { setSupplier(s.supplier); setCategory('') }}
            className={`px-4 py-2 rounded-lg text-[13px] font-medium border ${supplier === s.supplier ? 'bg-[#111110] text-white border-[#111110]' : 'bg-white text-[#4b4b47] border-[#e4e4e0] hover:border-[#c4c4be]'}`}>
            {s.title} <span className="opacity-60">−{s.discount_percent}%</span>
          </button>
        ))}
        {src && (
          <div className="flex items-center gap-1.5 ml-2 text-[13px]">
            <span className="text-[#8a8a85]">Скидка {src.title}:</span>
            <input type="number" value={discEdit} onChange={e => setDiscEdit(e.target.value)}
              className="w-16 text-right font-mono border border-[#e4e4e0] rounded-md px-1.5 py-1 focus:border-[#111110] outline-none" />
            <span className="text-[#9a9a95]">%</span>
            <button onClick={saveDiscount} disabled={savingDisc || Number(discEdit) === src.discount_percent}
              className={`px-3 py-1 rounded-md text-[12px] font-medium ${!savingDisc && Number(discEdit) !== src.discount_percent ? 'bg-[#111110] text-white' : 'bg-[#eee] text-[#9a9a95]'}`}>
              {savingDisc ? '…' : 'Пересчитать'}
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-5 items-start">
        {/* Категории */}
        <div className="lg:sticky lg:top-4 max-h-[80vh] overflow-auto pr-1">
          <button onClick={() => setCategory('')}
            className={`w-full text-left px-3 py-1.5 rounded-md text-[13px] mb-1 ${category === '' ? 'bg-[#111110] text-white' : 'text-[#4b4b47] hover:bg-[#f0f0ec]'}`}>
            Все категории
          </button>
          {data?.categories.map(c => (
            <button key={c.category} onClick={() => setCategory(c.category)}
              className={`w-full text-left px-3 py-1.5 rounded-md text-[12px] flex justify-between gap-2 ${category === c.category ? 'bg-[#111110] text-white' : 'text-[#4b4b47] hover:bg-[#f0f0ec]'}`}>
              <span className="truncate">{c.category}</span><span className="opacity-60 shrink-0">{c.cnt}</span>
            </button>
          ))}
        </div>

        {/* Таблица */}
        <div className="min-w-0">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Поиск по названию или артикулу…"
            className="w-full text-[13px] border border-[#e4e4e0] rounded-lg px-3 py-2 mb-3 focus:border-[#111110] outline-none" />

          <div className="bg-white border border-[#e4e4e0] rounded-xl overflow-hidden">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-[#8a8a85] border-b border-[#e4e4e0]">
                  <th className="text-left font-semibold px-3 py-2">Наименование</th>
                  <th className="text-left font-semibold px-2 py-2 hidden md:table-cell">Артикул</th>
                  <th className="text-left font-semibold px-2 py-2 hidden sm:table-cell">Цвет</th>
                  <th className="text-right font-semibold px-2 py-2">Розница</th>
                  <th className="text-right font-semibold px-3 py-2">Себест.</th>
                </tr>
              </thead>
              <tbody>
                {data?.rows.map(r => (
                  <tr key={r.id} className="border-b border-[#f4f4f0] last:border-0 hover:bg-[#fafaf9]">
                    <td className="px-3 py-1.5 text-[#111110]">{r.name}</td>
                    <td className="px-2 py-1.5 font-mono text-[12px] text-[#6b6b66] hidden md:table-cell">{r.article}</td>
                    <td className="px-2 py-1.5 text-[#6b6b66] hidden sm:table-cell">{r.color}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-[#9a9a95] line-through">{rub(r.retail_price)}</td>
                    <td className="px-3 py-1.5 text-right font-mono font-semibold text-[#111110]">{rub(r.cost_price)}</td>
                  </tr>
                ))}
                {!loading && data?.rows.length === 0 && (
                  <tr><td colSpan={5} className="px-3 py-6 text-center text-[#9a9a95]">Ничего не найдено</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between mt-3 text-[13px] text-[#6b6b66]">
            <span>{loading ? 'Загрузка…' : `${data?.total ?? 0} позиций`}</span>
            {totalPages > 1 && (
              <div className="flex items-center gap-2">
                <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                  className="px-3 py-1 rounded-md border border-[#e4e4e0] disabled:opacity-40">←</button>
                <span>{page + 1} / {totalPages}</span>
                <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
                  className="px-3 py-1 rounded-md border border-[#e4e4e0] disabled:opacity-40">→</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
