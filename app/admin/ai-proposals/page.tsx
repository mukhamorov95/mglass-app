'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'

type ProposalListItem = {
  id: number
  created_at: string
  status: string
  proposal_title: string | null
  client_name: string | null
  action_type: string
  warnings: string[]
  errors: unknown[]
  approved_at: string | null
  rejected_at: string | null
  created_by: string | null
}

const STATUS_FILTERS = [
  { key: 'all',              label: 'Все' },
  { key: 'pending_approval', label: 'На проверке' },
  { key: 'approved',         label: 'Одобрено' },
  { key: 'rejected',         label: 'Отклонено' },
  { key: 'failed',           label: 'Ошибка' },
]

const STATUS_BADGE: Record<string, { cls: string; label: string }> = {
  draft:            { cls: 'bg-gray-100 text-gray-500',     label: 'Черновик' },
  pending_approval: { cls: 'bg-amber-100 text-amber-700',   label: 'На проверке' },
  approved:         { cls: 'bg-emerald-100 text-emerald-700', label: 'Одобрено' },
  rejected:         { cls: 'bg-red-100 text-red-600',       label: 'Отклонено' },
  failed:           { cls: 'bg-red-50 text-red-400',        label: 'Ошибка' },
  archived:         { cls: 'bg-gray-100 text-gray-400',     label: 'Архив' },
}

function statusBadge(status: string) {
  return STATUS_BADGE[status] ?? { cls: 'bg-gray-100 text-gray-400', label: status }
}

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

export default function AIProposalsPage() {
  const [items,   setItems]   = useState<ProposalListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [filter,  setFilter]  = useState('all')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const qs  = filter === 'all' ? '' : `&status=${filter}`
      const res  = await fetch(`/api/ai/proposals?limit=50${qs}`)
      const data = await res.json() as { ok: boolean; items?: ProposalListItem[]; error?: string }
      if (!res.ok || !data.ok) {
        setError(data.error ?? 'Не удалось загрузить список')
        setItems([])
      } else {
        setItems(data.items ?? [])
      }
    } catch {
      setError('Ошибка сети')
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => { load() }, [load])

  return (
    <div className="min-h-screen bg-[#f7f7f6]">
      <div className="max-w-5xl mx-auto px-4 py-4">

        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div>
            <h1 className="text-base font-semibold text-[#111110]">AI Черновики КП</h1>
            <p className="text-xs text-[#9a9a95] mt-0.5">
              Черновики, сгенерированные proposal-engineer агентом
            </p>
          </div>
          <button onClick={load}
            className="h-7 px-2.5 rounded-lg text-[11px] border border-[#e8e8e5] text-[#6b6b66] hover:bg-white transition-colors">
            ↻ Обновить
          </button>
        </div>

        {/* Safety notice */}
        <div className="mb-4 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-xl">
          <p className="text-xs text-amber-800">
            Утверждение здесь <strong>не отправляет</strong> КП клиенту.
            Это внутреннее подтверждение черновика для последующей ручной отправки.
          </p>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1 mb-4 flex-wrap">
          {STATUS_FILTERS.map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`h-7 px-3 rounded-lg text-[11px] font-medium transition-colors ${
                filter === f.key
                  ? 'bg-[#111110] text-white'
                  : 'bg-white border border-[#e8e8e5] text-[#6b6b66] hover:bg-[#f5f5f3]'
              }`}>
              {f.label}
            </button>
          ))}
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center gap-2 text-[#9a9a95] text-xs py-12 justify-center">
            <div className="w-4 h-4 border-2 border-[#d0d0cc] border-t-[#9a9a95] rounded-full animate-spin" />
            Загрузка...
          </div>
        ) : error ? (
          <div className="bg-white rounded-xl border border-red-100 px-4 py-8 text-center">
            <p className="text-sm text-red-500">{error}</p>
            <button onClick={load} className="mt-3 text-xs text-[#9a9a95] underline">Повторить</button>
          </div>
        ) : items.length === 0 ? (
          <div className="bg-white rounded-xl border border-[#e8e8e5] px-4 py-12 text-center">
            <p className="text-sm text-[#9a9a95]">Черновики не найдены</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-[#e8e8e5] overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#f0f0ee]">
                  <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-[#a8a8a3] uppercase tracking-wide w-12">#</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-[#a8a8a3] uppercase tracking-wide">Черновик</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-[#a8a8a3] uppercase tracking-wide">Статус</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-[#a8a8a3] uppercase tracking-wide">Создан</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-[#a8a8a3] uppercase tracking-wide">Флаги</th>
                  <th className="px-4 py-2.5 text-right text-[10px] font-semibold text-[#a8a8a3] uppercase tracking-wide"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f7f7f7]">
                {items.map(item => {
                  const badge     = statusBadge(item.status)
                  const warnCount = Array.isArray(item.warnings) ? item.warnings.length : 0
                  const errCount  = Array.isArray(item.errors)   ? item.errors.length   : 0
                  return (
                    <tr key={item.id} className="hover:bg-[#fafafa] transition-colors">
                      <td className="px-4 py-3 text-[11px] text-[#9a9a95] font-mono">{item.id}</td>
                      <td className="px-4 py-3">
                        <p className="text-[12px] font-medium text-[#111110] truncate max-w-xs">
                          {item.proposal_title ?? <span className="text-[#9a9a95] font-normal italic">Без названия</span>}
                        </p>
                        {item.client_name && (
                          <p className="text-[10px] text-[#9a9a95] mt-0.5">{item.client_name}</p>
                        )}
                        {item.created_by && (
                          <p className="text-[10px] text-[#b8b8b4] mt-0.5">{item.created_by}</p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${badge.cls}`}>
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[11px] text-[#6b6b66] whitespace-nowrap">
                        {fmtDate(item.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          {warnCount > 0 && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-600">
                              {warnCount}W
                            </span>
                          )}
                          {errCount > 0 && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-500">
                              {errCount}E
                            </span>
                          )}
                          {warnCount === 0 && errCount === 0 && (
                            <span className="text-[10px] text-[#d0d0cc]">—</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link href={`/admin/ai-proposals/${item.id}`}
                          className="h-6 px-2.5 rounded-lg text-[11px] border border-[#e8e8e5] text-[#4b4b47] hover:bg-[#f5f5f3] transition-colors inline-flex items-center gap-1">
                          Открыть →
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer note */}
        {items.length > 0 && (
          <p className="mt-3 text-[10px] text-[#b8b8b4] text-center">
            Показано {items.length} записей · одобрение не отправляет КП клиенту
          </p>
        )}

      </div>
    </div>
  )
}
