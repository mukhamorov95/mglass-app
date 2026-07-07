'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'

// Ставки себестоимости лофт-производства: металл (₽/пог.м), работы и расходники
// (₽/пог.м металла), фурнитура (₽/шт). Их использует лофт в B2B-калькуляторе.

type Rate = { key: string; label: string; unit: string; value: number; sort: number }

export default function LoftRatesPage() {
  const sb = createClient()
  const [rates, setRates] = useState<Rate[]>([])
  const [loading, setLoading] = useState(true)
  const [savedKey, setSavedKey] = useState<string | null>(null)

  useEffect(() => {
    sb.from('loft_rates').select('*').order('sort')
      .then(({ data }) => { setRates((data ?? []) as Rate[]); setLoading(false) })
  }, [sb])

  async function save(key: string, value: number) {
    setRates(prev => prev.map(r => r.key === key ? { ...r, value } : r))
    const { error } = await sb.from('loft_rates').update({ value }).eq('key', key)
    if (!error) { setSavedKey(key); setTimeout(() => setSavedKey(null), 1200) }
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center text-[13px] text-[#8a8a85]">Загрузка…</div>

  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-20">
      <div className="bg-white border-b border-[#e4e4e0] px-5 pt-6 pb-4">
        <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">Лофт — ставки себестоимости</h1>
        <p className="text-[12px] text-[#9a9a95] mt-0.5">Металл — за пог.м проката; сварка, расходники и покраска — за пог.м металла; фурнитура — за штуку. Меняются здесь — сразу действуют в лофте B2B-калькулятора.</p>
      </div>
      <div className="px-5 pt-4 max-w-[720px]">
        <div className="bg-white rounded-xl border border-[#e4e4e0] divide-y divide-[#f5f5f3]">
          {rates.map(r => (
            <div key={r.key} className="flex items-center gap-3 px-4 py-2.5">
              <div className="flex-1 min-w-0">
                <p className="text-[13px] text-[#111110]">{r.label}</p>
                <p className="text-[11px] text-[#9a9a95]">{r.unit}</p>
              </div>
              <input type="number" value={r.value}
                onChange={e => setRates(prev => prev.map(x => x.key === r.key ? { ...x, value: Number(e.target.value) } : x))}
                onBlur={e => save(r.key, Number(e.target.value) || 0)}
                className="w-28 bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-3 py-1.5 text-[13px] font-mono text-right outline-none focus:border-[#111110]" />
              {savedKey === r.key && <span className="text-[11px] text-emerald-600">✓</span>}
            </div>
          ))}
        </div>
        <p className="text-[11px] text-[#9a9a95] mt-3">Маржа и налог лофт-производства настраиваются в «Ценообразовании v2» (категория loft). Цена стекла — из матрицы стеклопрайса (COST).</p>
      </div>
    </div>
  )
}
