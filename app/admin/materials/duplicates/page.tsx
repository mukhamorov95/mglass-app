'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { DupeGroup, MaterialRow, ServiceRow } from '@/lib/b2b/dupeAudit'

// Отчёт «подозрение на дубль». Только показывает: слияние и правку справочника
// делает владелец. Себестоимость гейтит API (admin/ceo/buyer) — сюда доходит
// уже отфильтрованной по правам.

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU')

type Resp = {
  materials: DupeGroup<MaterialRow>[]
  services: DupeGroup<ServiceRow>[]
  summary: { materialGroups: number; materialConflicts: number; topPriceOfQuestion: number; serviceGroups: number }
}

function CostBadge({ g }: { g: DupeGroup<MaterialRow | ServiceRow> }) {
  if (g.costDeltaRub <= 0) return <span className="text-[11px] text-[#9a9a95]">цена совпадает</span>
  return (
    <span className={`text-[11px] font-semibold ${g.costConflict ? 'text-red-600' : 'text-amber-600'}`}>
      расхождение {fmt(g.costDeltaRub)} ₽ · {g.costDeltaPct}%
    </span>
  )
}

export default function MaterialDuplicatesPage() {
  const [data, setData] = useState<Resp | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/admin/material-dupes')
      .then(async r => {
        if (!r.ok) { setError(r.status === 403 ? 'Нет доступа' : 'Не удалось загрузить'); return }
        setData(await r.json() as Resp)
      })
      .catch(() => setError('Ошибка сети'))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-2 text-[13px] mb-1">
        <Link href="/admin/materials" className="text-[#9a9a95] hover:text-[#6b6b66]">← Материалы</Link>
        <span className="text-[#d4d4d0]">/</span>
        <span className="font-semibold text-[#111110]">Подозрение на дубль</span>
      </div>
      <h1 className="text-[22px] font-bold text-[#111110]">Дубли справочника</h1>
      <p className="text-[13px] text-[#9a9a95] mt-0.5 mb-5 max-w-2xl">
        Одно изделие в нескольких строках с разной себестоимостью — маржа считается по-разному
        в зависимости от того, какую строку выбрал менеджер. Ниже — картина для решения; слияние
        строк делаете вы, отчёт ничего не правит.
      </p>

      {loading ? (
        <p className="text-[13px] text-[#9a9a95]">Загрузка…</p>
      ) : error ? (
        <p className="text-[13px] text-red-600">{error}</p>
      ) : !data ? null : (
        <>
          <div className="grid grid-cols-3 gap-3 mb-5">
            {[
              { v: data.summary.materialConflicts, l: 'конфликтов цены', tone: 'text-red-600' },
              { v: data.summary.materialGroups, l: 'групп-дублей', tone: 'text-[#111110]' },
              { v: `${fmt(data.summary.topPriceOfQuestion)} ₽`, l: 'макс. цена вопроса', tone: 'text-amber-600' },
            ].map(x => (
              <div key={x.l} className="bg-white border border-[#e4e4e0] rounded-2xl px-4 py-3">
                <p className={`text-[20px] font-bold ${x.tone}`}>{x.v}</p>
                <p className="text-[11px] text-[#9a9a95]">{x.l}</p>
              </div>
            ))}
          </div>

          {data.materials.length === 0 ? (
            <div className="bg-white border border-[#e4e4e0] rounded-2xl px-5 py-10 text-center">
              <p className="text-[15px] font-semibold text-[#111110]">Дублей нет</p>
              <p className="text-[12px] text-[#9a9a95] mt-1">Каждый материал заведён одной строкой.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {data.materials.map(g => (
                <div key={g.key} className={`bg-white border rounded-2xl overflow-hidden ${g.costConflict ? 'border-red-200' : 'border-[#e4e4e0]'}`}>
                  <div className="px-5 py-3 flex items-center justify-between gap-3 flex-wrap border-b border-[#f0f0ec]">
                    <div>
                      <p className="text-[14px] font-semibold text-[#111110]">{g.label}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <CostBadge g={g} />
                        {g.categoriesDiffer && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">разные категории</span>
                        )}
                        {g.costConflict && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-200">обе активны</span>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-[15px] font-bold text-[#111110] font-mono">{fmt(g.priceOfQuestion)} ₽</p>
                      <p className="text-[10px] text-[#9a9a95]">цена вопроса · {g.totalUses} исп.</p>
                    </div>
                  </div>
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-widest text-[#9a9a95] border-b border-[#f8f8f7]">
                        <th className="px-5 py-1.5">#</th>
                        <th className="py-1.5">Категория</th>
                        <th className="py-1.5 text-right">Себест.</th>
                        <th className="py-1.5 text-right">Отход</th>
                        <th className="py-1.5 text-right">Исп.</th>
                        <th className="py-1.5 text-right px-5">Статус</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.variants.map(v => (
                        <tr key={v.row.id} className="border-b border-[#f8f8f7] last:border-0">
                          <td className="px-5 py-1.5 font-mono text-[#9a9a95]">{v.row.id}</td>
                          <td className="py-1.5 text-[#111110]">{v.row.category ?? '—'}</td>
                          <td className="py-1.5 text-right font-mono font-semibold text-[#111110]">{fmt(v.row.cost_price)} ₽</td>
                          <td className="py-1.5 text-right font-mono text-[#6b6b66]">{v.row.waste_percent ?? '—'}%</td>
                          <td className="py-1.5 text-right font-mono text-[#6b6b66]">{v.uses}</td>
                          <td className="py-1.5 text-right px-5">
                            {v.row.active
                              ? <span className="text-[11px] text-emerald-600 font-medium">активна</span>
                              : <span className="text-[11px] text-[#9a9a95]">выкл.</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}

          {data.services.length > 0 && (
            <>
              <h2 className="text-[16px] font-bold text-[#111110] mt-8 mb-2">Услуги</h2>
              <div className="space-y-2">
                {data.services.map(g => (
                  <div key={g.key} className="bg-white border border-[#e4e4e0] rounded-xl px-5 py-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[13px] font-semibold text-[#111110]">{g.label}</p>
                      <CostBadge g={g} />
                    </div>
                    <p className="text-[11px] text-[#9a9a95]">
                      {g.variants.map(v => `#${v.row.id}${v.row.active ? '' : ' (выкл.)'}`).join(' · ')}
                    </p>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
