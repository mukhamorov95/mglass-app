'use client'

import { useState } from 'react'
import { PageHeader, EmptyState } from '@/components/ds'

type Stats = {
  total: number
  totalValue: number
  stale7Count: number
  stale7Value: number
  stale14Count: number
}

type StageRow = { name: string; count: number; value: number }
type ManagerRow = { name: string; count: number; value: number; stale: number }
type CriticalDeal = { name: string; value: number; stage: string; manager: string; days: number }

type Data = {
  stats: Stats
  byStage: StageRow[]
  byManager: ManagerRow[]
  critical: CriticalDeal[]
  analysis: string
}

function fmt(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} млн ₽`
  return `${Math.round(n / 1000)} тыс. ₽`
}

export default function AmoAnalysisPage() {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/amo/analyze')
      const json = await res.json()
      if (json.error) throw new Error(json.error)
      setData(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }

  const riskPct = data ? Math.round(data.stats.stale7Value / data.stats.totalValue * 100) : 0

  return (
    <div className="max-w-[900px] mx-auto px-6 py-8">
      <PageHeader
        title="Анализ воронки AmoCRM"
        subtitle="AI-отчёт как CFO + Руководитель отдела продаж"
        actions={
          <button onClick={load} disabled={loading}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-ink text-white text-[13px] font-semibold disabled:opacity-40 hover:bg-[#2a2a28] transition-colors">
            {loading
              ? <><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>Анализирую...</>
              : <>{data ? '↻ Обновить' : 'Запустить анализ'}</>
            }
          </button>
        }
      />

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-[13px] text-red-700 mb-4">{error}</div>
      )}

      {!data && !loading && (
        <EmptyState
          icon={<div className="w-14 h-14 rounded-2xl bg-line-soft flex items-center justify-center text-[28px]">📊</div>}
          title="Готов к анализу"
          hint="Нажми «Запустить анализ» — AI загрузит все активные сделки из AmoCRM и даст оценку как CFO и руководитель отдела продаж"
        />
      )}

      {data && (
        <div className="space-y-4">
          {/* Карточки-метрики */}
          <div className="grid grid-cols-4 gap-3">
            <div className="bg-surface border border-line rounded-xl p-4">
              <p className="text-[11px] font-semibold text-muted uppercase tracking-widest mb-1">В воронке</p>
              <p className="text-[22px] font-semibold text-ink tabular-nums">{fmt(data.stats.totalValue)}</p>
              <p className="text-[12px] text-muted mt-0.5 tabular-nums">{data.stats.total} сделок</p>
            </div>
            <div className={`border rounded-xl p-4 ${riskPct > 40 ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'}`}>
              <p className="text-[11px] font-semibold text-muted uppercase tracking-widest mb-1">Под риском</p>
              <p className={`text-[22px] font-semibold tabular-nums ${riskPct > 40 ? 'text-red-700' : 'text-amber-700'}`}>{fmt(data.stats.stale7Value)}</p>
              <p className="text-[12px] text-muted mt-0.5 tabular-nums">{data.stats.stale7Count} сд. без активности 7+ дн.</p>
            </div>
            <div className="bg-surface border border-line rounded-xl p-4">
              <p className="text-[11px] font-semibold text-muted uppercase tracking-widest mb-1">Критичных</p>
              <p className="text-[22px] font-semibold text-ink tabular-nums">{data.stats.stale14Count}</p>
              <p className="text-[12px] text-muted mt-0.5">14+ дней без движения</p>
            </div>
            <div className={`border rounded-xl p-4 ${riskPct > 40 ? 'bg-red-50 border-red-200' : 'bg-emerald-50 border-emerald-200'}`}>
              <p className="text-[11px] font-semibold text-muted uppercase tracking-widest mb-1">% под риском</p>
              <p className={`text-[22px] font-semibold tabular-nums ${riskPct > 40 ? 'text-red-700' : 'text-emerald-700'}`}>{riskPct}%</p>
              <p className="text-[12px] text-muted mt-0.5">от суммы воронки</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* По этапам */}
            <div className="bg-surface border border-line rounded-xl p-4">
              <h3 className="text-[12px] font-semibold text-muted uppercase tracking-widest mb-3">По этапам</h3>
              <div className="space-y-2">
                {data.byStage.map(s => (
                  <div key={s.name} className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-[12px] text-ink truncate pr-2">{s.name}</span>
                        <span className="text-[12px] font-semibold text-ink whitespace-nowrap tabular-nums">{fmt(s.value)}</span>
                      </div>
                      <div className="h-1.5 bg-line-soft rounded-full overflow-hidden">
                        <div className="h-full bg-ink rounded-full"
                          style={{ width: `${Math.round(s.value / data.stats.totalValue * 100)}%` }} />
                      </div>
                    </div>
                    <span className="text-[11px] text-muted ml-3 w-8 text-right tabular-nums">{s.count}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* По менеджерам */}
            <div className="bg-surface border border-line rounded-xl p-4">
              <h3 className="text-[12px] font-semibold text-muted uppercase tracking-widest mb-3">По менеджерам</h3>
              <div className="space-y-2.5">
                {data.byManager.map(m => (
                  <div key={m.name}>
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-[12px] text-ink font-medium">{m.name}</span>
                      <div className="flex items-center gap-2">
                        {m.stale > 0 && (
                          <span className="text-[11px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-semibold tabular-nums">{m.stale} зависших</span>
                        )}
                        <span className="text-[12px] font-semibold text-ink tabular-nums">{fmt(m.value)}</span>
                      </div>
                    </div>
                    <div className="h-1.5 bg-line-soft rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500 rounded-full"
                        style={{ width: `${Math.round(m.value / data.stats.totalValue * 100)}%` }} />
                    </div>
                    <p className="text-[11px] text-muted mt-0.5 tabular-nums">{m.count} сделок</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Критичные сделки */}
          {data.critical.length > 0 && (
            <div className="bg-surface border border-line rounded-xl p-4">
              <h3 className="text-[12px] font-semibold text-muted uppercase tracking-widest mb-3">
                Критичные сделки — {data.critical.length} сд., требуют немедленного внимания
              </h3>
              <div className="space-y-2">
                {data.critical.map((d, i) => (
                  <div key={i} className="flex items-center gap-3 py-2 border-b border-line-soft last:border-0">
                    <div className={`text-[11px] font-semibold px-2 py-0.5 rounded-lg tabular-nums ${d.days > 21 ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-700'}`}>
                      {d.days} дн.
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-semibold text-ink truncate">{d.name}</p>
                      <p className="text-[11px] text-muted">{d.stage} · {d.manager}</p>
                    </div>
                    <span className="text-[12px] font-semibold text-ink whitespace-nowrap tabular-nums">{fmt(d.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* AI Анализ */}
          <div className="bg-surface border border-line rounded-xl p-5">
            <h3 className="text-[13px] font-semibold text-ink mb-4 flex items-center gap-2">
              <span className="w-6 h-6 bg-ink rounded-lg flex items-center justify-center text-white text-[11px]">AI</span>
              Анализ и рекомендации
            </h3>
            <div className="text-[13px] text-ink leading-relaxed whitespace-pre-wrap">
              {data.analysis}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
