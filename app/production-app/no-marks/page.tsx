'use client'

import { useEffect, useState } from 'react'
import ProductionTabs from '@/components/ProductionTabs'
import { stageLabel } from '@/lib/productionStages'

// «Без отметок» — изделия, у которых этап закрылся каскадом, а не рукой мастера.
// Работа сделана (иначе изделие не дошло бы до упаковки), но станция её не отметила:
// выработка не засчитана, и по табло не видно, где заказ стоял на самом деле.

type StageRow = { stage: string; live: number; auto: number; pct: number }
type ActorRow = { name: string; total: number; stages: { stage: string; items: number; orders: number }[] }
type Report = { days: number; total: number; stages: StageRow[]; actors: ActorRow[] }

const PERIODS = [7, 30, 90] as const

export default function NoMarksPage() {
  const [days, setDays] = useState<number>(30)
  const [rep, setRep] = useState<Report | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let off = false
    const t = setTimeout(() => setLoading(true), 0)
    fetch(`/api/production/cascade-report?days=${days}`)
      .then(r => r.json())
      .then(j => { if (!off) setRep(j?.stages ? j : null) })
      .catch(() => { if (!off) setRep(null) })
      .finally(() => { if (!off) setLoading(false) })
    return () => { off = true; clearTimeout(t) }
  }, [days])

  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-20">
      <div className="bg-white border-b border-[#e4e4e0] px-4 pt-12 pb-4 lg:pt-6">
        <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">Изделия без отметок</h1>
        <p className="text-[13px] text-[#9a9a95] mt-0.5">
          Этап закрылся сам, когда следующий мастер отметил свой. Работа сделана, но станция её не отметила.
        </p>
        <ProductionTabs />
      </div>

      <div className="px-4 pt-4 space-y-4">
        <div className="flex gap-2">
          {PERIODS.map(d => (
            <button key={d} onClick={() => setDays(d)}
              className={`px-3.5 py-2 rounded-lg text-[13px] font-medium border ${
                days === d ? 'bg-[#111110] text-white border-[#111110]' : 'bg-white text-[#111110] border-[#e4e4e0]'}`}>
              {d} дней
            </button>
          ))}
        </div>

        {loading && <p className="text-[13px] text-[#9a9a95]">Считаю…</p>}

        {!loading && rep && (
          <>
            <div className="bg-white rounded-xl border border-[#e4e4e0] px-4 py-3">
              <p className="text-[11px] uppercase tracking-wide text-[#9a9a95]">Закрыто без живой отметки</p>
              <p className="text-[26px] font-bold text-[#111110] mt-0.5">{rep.total}</p>
              <p className="text-[12px] text-[#6b6b66]">задач за {rep.days} дней</p>
            </div>

            <div className="bg-white rounded-xl border border-[#e4e4e0] overflow-hidden">
              <p className="px-4 pt-3 pb-2 text-[13px] font-semibold text-[#111110]">По станциям</p>
              <div className="divide-y divide-[#f0f0ee]">
                {rep.stages.map(s => (
                  <div key={s.stage} className="px-4 py-2.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[13px] text-[#111110]">{stageLabel(s.stage)}</span>
                      <span className={`text-[13px] font-semibold ${s.pct >= 50 ? 'text-red-600' : s.pct >= 20 ? 'text-amber-600' : 'text-[#6b6b66]'}`}>
                        {s.pct}% без отметки
                      </span>
                    </div>
                    <p className="text-[12px] text-[#9a9a95] mt-0.5">
                      отметили руками {s.live} · закрылось само {s.auto}
                    </p>
                    <div className="mt-1.5 h-1.5 rounded-full bg-[#f0f0ee] overflow-hidden">
                      <div className={`h-full rounded-full ${s.pct >= 50 ? 'bg-red-500' : s.pct >= 20 ? 'bg-amber-500' : 'bg-[#111110]'}`}
                        style={{ width: `${Math.min(s.pct, 100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-xl border border-[#e4e4e0] overflow-hidden">
              <p className="px-4 pt-3 pb-1 text-[13px] font-semibold text-[#111110]">Чья отметка закрыла чужие этапы</p>
              <p className="px-4 pb-2 text-[12px] text-[#9a9a95]">
                Это не его работа — так система догоняет то, что не отметили раньше.
              </p>
              <div className="divide-y divide-[#f0f0ee]">
                {rep.actors.map(a => (
                  <div key={a.name} className="px-4 py-2.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[13px] font-medium text-[#111110]">{a.name}</span>
                      <span className="text-[13px] font-semibold text-[#111110]">{a.total}</span>
                    </div>
                    <p className="text-[12px] text-[#9a9a95] mt-0.5">
                      {a.stages.map(s => `${stageLabel(s.stage)} — ${s.items} изд. (${s.orders} зак.)`).join(' · ')}
                    </p>
                  </div>
                ))}
                {rep.actors.length === 0 && (
                  <p className="px-4 py-3 text-[13px] text-[#9a9a95]">За период таких изделий нет.</p>
                )}
              </div>
            </div>
          </>
        )}

        {!loading && !rep && <p className="text-[13px] text-[#9a9a95]">Не удалось загрузить отчёт.</p>}
      </div>
    </div>
  )
}
