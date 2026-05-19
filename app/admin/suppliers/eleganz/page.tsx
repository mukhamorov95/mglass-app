'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'

type PriceItem = {
  id:         number
  supplier:   string
  category:   string
  name:       string
  article:    string | null
  price_usd:  number | null
  price_rub:  number | null
  currency:   string
  unit:       string
  notes:      string | null
  active:     boolean
  sort_order: number
}

type CbrData = {
  rate:  number
  date:  string
  error?: boolean
}

function formatRub(val: number): string {
  return val.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatUsd(val: number): string {
  return val.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatCbrDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
  } catch {
    return iso
  }
}

export default function EleganzPricePage() {
  const [items,   setItems]   = useState<PriceItem[]>([])
  const [cbr,     setCbr]     = useState<CbrData | null>(null)
  const [loading, setLoading] = useState(true)
  const [search,  setSearch]  = useState('')
  const [copying, setCopying] = useState<number | null>(null)
  const [copied,  setCopied]  = useState<Set<number>>(new Set())

  useEffect(() => {
    async function load() {
      setLoading(true)

      const sb = createClient()
      const [{ data: priceData }, cbrRes] = await Promise.all([
        sb.from('supplier_price_items')
          .select('*')
          .eq('supplier', 'eleganz')
          .eq('active', true)
          .order('category')
          .order('sort_order'),
        fetch('/api/cbr-rate'),
      ])

      const cbrJson: CbrData = await cbrRes.json()
      setItems((priceData as PriceItem[]) ?? [])
      setCbr(cbrJson)
      setLoading(false)
    }

    load()
  }, [])

  const effectiveRate = cbr ? cbr.rate + 2 : 84

  async function copyToMaterials(item: PriceItem, priceRub: number) {
    setCopying(item.id)
    const res = await fetch('/api/admin/materials/from-supplier', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name:       item.name,
        short_name: item.article ? item.article : null,
        category:   'подсветка',
        unit:       item.unit,
        cost_price: Math.round(priceRub),
      }),
    })
    setCopying(null)
    if (res.ok) {
      setCopied(prev => new Set(prev).add(item.id))
    } else {
      const err = await res.json()
      alert('Ошибка: ' + (err.error ?? 'неизвестно'))
    }
  }

  const filtered = items.filter(it => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (
      it.name.toLowerCase().includes(q) ||
      (it.article ?? '').toLowerCase().includes(q)
    )
  })

  const grouped = filtered.reduce<Record<string, PriceItem[]>>((acc, item) => {
    if (!acc[item.category]) acc[item.category] = []
    acc[item.category].push(item)
    return acc
  }, {})

  const categories = Object.keys(grouped)

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">

      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-[22px] font-bold text-[#111110]">Прайс-лист Eleganz</h1>
          <p className="text-[13px] text-[#8a8a85] mt-0.5">Июль 2025 г. &mdash; LED освещение</p>
        </div>
        {copied.size > 0 && (
          <a href="/admin/materials"
            className="h-8 px-3 rounded-lg text-[12px] bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-100 transition-colors flex items-center gap-1.5">
            ✓ Скопировано {copied.size} поз. → Материалы
          </a>
        )}
      </div>

      {/* CBR banner */}
      {cbr && (
        <div className={`mb-5 px-4 py-3 rounded-xl border text-[12px] ${
          cbr.error
            ? 'bg-amber-50 border-amber-200 text-amber-800'
            : 'bg-blue-50 border-blue-200 text-blue-800'
        }`}>
          {cbr.error ? (
            <span>Курс ЦБ РФ недоступен. Используется резервный курс: <strong>{cbr.rate} ₽/$</strong> + 2 ₽ = <strong>{(cbr.rate + 2).toFixed(2)} ₽</strong></span>
          ) : (
            <span>
              Курс ЦБ РФ:{' '}
              <strong>{cbr.rate.toFixed(4)} ₽/$</strong>
              {' '}+ 2 ₽ = <strong>{(cbr.rate + 2).toFixed(4)} ₽</strong>
              {' '}|{' '}
              Дата: <strong>{formatCbrDate(cbr.date)}</strong>
              {' '}|{' '}
              Цены пересчитываются автоматически
            </span>
          )}
        </div>
      )}

      {/* Search */}
      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Поиск по названию или артикулу..."
        className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] mb-5 outline-none focus:border-[#0071e3] bg-white"
      />

      {loading ? (
        <div className="bg-white border border-[#e4e4e0] rounded-xl p-12 text-center">
          <p className="text-[13px] text-[#9a9a95]">Загрузка прайс-листа...</p>
        </div>
      ) : categories.length === 0 ? (
        <div className="bg-white border border-[#e4e4e0] rounded-xl p-12 text-center">
          <p className="text-[13px] text-[#9a9a95]">Ничего не найдено</p>
        </div>
      ) : (
        <div className="space-y-6">
          {categories.map(cat => {
            const catItems = grouped[cat]
            return (
              <div key={cat} className="bg-white border border-[#e4e4e0] rounded-xl overflow-hidden">
                <div className="px-4 py-3 bg-[#f8f8f7] border-b border-[#e4e4e0] flex items-center justify-between">
                  <h2 className="text-[13px] font-semibold text-[#111110]">{cat}</h2>
                  <span className="text-[11px] text-[#9a9a95]">{catItems.length} поз.</span>
                </div>

                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="border-b border-[#e4e4e0] bg-[#fafaf9]">
                      <th className="px-4 py-2 text-left font-medium text-[#6b6b66] w-[110px]">Артикул</th>
                      <th className="px-4 py-2 text-left font-medium text-[#6b6b66]">Название</th>
                      <th className="px-4 py-2 text-left font-medium text-[#6b6b66] w-[60px]">Ед.</th>
                      <th className="px-4 py-2 text-right font-medium text-[#6b6b66] w-[90px]">Цена ($)</th>
                      <th className="px-4 py-2 text-right font-medium text-[#6b6b66] w-[100px]">Цена (₽)</th>
                      <th className="px-2 py-2 w-[90px]"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {catItems.map((item, idx) => {
                      const isUsd    = item.currency === 'USD'
                      const priceRub = isUsd
                        ? (item.price_usd ?? 0) * effectiveRate
                        : (item.price_rub ?? 0)
                      const isCopied  = copied.has(item.id)
                      const isCopying = copying === item.id

                      return (
                        <tr
                          key={item.id}
                          className={`border-b border-[#f0f0ee] last:border-0 transition-colors ${
                            isCopied ? 'bg-emerald-50' : idx % 2 === 0 ? 'hover:bg-[#fafaf9]' : 'bg-[#fdfdfb] hover:bg-[#fafaf9]'
                          }`}
                        >
                          <td className="px-4 py-2 text-[#9a9a95] font-mono text-[11px] whitespace-nowrap">
                            {item.article ?? '—'}
                          </td>
                          <td className="px-4 py-2 text-[#111110]">{item.name}</td>
                          <td className="px-4 py-2 text-[#6b6b66] whitespace-nowrap">{item.unit}</td>
                          <td className="px-4 py-2 text-right text-[#6b6b66] whitespace-nowrap">
                            {isUsd && item.price_usd != null
                              ? `$${formatUsd(item.price_usd)}`
                              : '—'}
                          </td>
                          <td className="px-4 py-2 text-right font-medium text-[#111110] whitespace-nowrap">
                            {formatRub(priceRub)} ₽
                          </td>
                          <td className="px-2 py-1.5 text-center">
                            <button
                              onClick={() => copyToMaterials(item, priceRub)}
                              disabled={isCopying || isCopied}
                              className={`h-7 px-2.5 rounded-md text-[11px] font-medium border transition-colors whitespace-nowrap ${
                                isCopied
                                  ? 'bg-emerald-50 border-emerald-200 text-emerald-600 cursor-default'
                                  : isCopying
                                  ? 'bg-[#f5f5f3] border-[#e4e4e0] text-[#9a9a95] cursor-wait'
                                  : 'bg-white border-[#e4e4e0] text-[#4b4b47] hover:bg-[#f0f0ee] hover:border-[#c8c8c4]'
                              }`}
                            >
                              {isCopied ? '✓ В материалах' : isCopying ? '...' : '+ В материалы'}
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )
          })}
        </div>
      )}

      {!loading && items.length > 0 && (
        <p className="text-[11px] text-[#b0b0aa] text-center mt-6">
          Всего позиций: {items.length} &mdash; Прайс Eleganz, цены в USD пересчитаны по курсу ЦБ РФ + 2 ₽
        </p>
      )}
    </div>
  )
}
