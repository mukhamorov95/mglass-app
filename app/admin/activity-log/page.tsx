'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'

type LogEntry = {
  id: number
  user_id: string | null
  user_name: string | null
  action: string
  entity_type: string | null
  entity_id: string | null
  details: Record<string, unknown> | null
  created_at: string
}

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  'user.update':            { label: 'Изменение пользователя', color: 'bg-blue-50 text-blue-700' },
  'user.permission_change': { label: 'Изменение прав',         color: 'bg-violet-50 text-violet-700' },
  'user.password_change':   { label: 'Смена пароля',           color: 'bg-amber-50 text-amber-700' },
  'order.create':           { label: 'Создан заказ',           color: 'bg-emerald-50 text-emerald-700' },
  'order.update':           { label: 'Изменён заказ',          color: 'bg-blue-50 text-blue-700' },
  'order.delete':           { label: 'Архивирован заказ',      color: 'bg-red-50 text-red-700' },
  'order.status_change':    { label: 'Смена статуса',          color: 'bg-orange-50 text-orange-700' },
  'order.price_change':     { label: 'Изменение цены',         color: 'bg-rose-50 text-rose-700' },
  'order.discount_given':   { label: 'Выдана скидка',          color: 'bg-amber-50 text-amber-700' },
  'quote.create':           { label: 'Создан просчёт',         color: 'bg-emerald-50 text-emerald-700' },
  'quote.update':           { label: 'Изменён просчёт',        color: 'bg-blue-50 text-blue-700' },
  'quote.delete':           { label: 'Архивирован просчёт',    color: 'bg-red-50 text-red-700' },
  'calculation.create':     { label: 'Создан расчёт',          color: 'bg-emerald-50 text-emerald-700' },
  'calculation.update':     { label: 'Обновлён расчёт',        color: 'bg-blue-50 text-blue-700' },
  'pdf.download':           { label: 'Скачан PDF',             color: 'bg-[#f5f5f3] text-[#6b6b66]' },
}

function fmtDate(s: string) {
  return new Date(s).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function ActivityLogPage() {
  const [entries, setEntries]       = useState<LogEntry[]>([])
  const [loading, setLoading]       = useState(true)
  const [tableExists, setTableExists] = useState(true)
  const [filterAction, setFilterAction] = useState('')
  const [filterUser, setFilterUser]     = useState('')

  useEffect(() => { loadLog().catch(() => setLoading(false)) }, [])

  async function loadLog() {
    setLoading(true)
    const sb = createClient()
    const { data, error } = await sb
      .from('activity_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500)

    if (error) {
      if (error.message.includes('does not exist') || error.code === '42P01') {
        setTableExists(false)
      }
      setLoading(false)
      return
    }

    setEntries((data ?? []) as LogEntry[])
    setLoading(false)
  }

  const filtered = entries.filter(e => {
    if (filterAction && e.action !== filterAction) return false
    if (filterUser && !(e.user_name ?? '').toLowerCase().includes(filterUser.toLowerCase())) return false
    return true
  })

  const uniqueActions = [...new Set(entries.map(e => e.action))].sort()

  if (!tableExists) {
    return (
      <div className="min-h-screen bg-[#f8f8f7] p-6">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-[18px] font-semibold text-[#111110] mb-2">Лог действий</h1>
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-6">
            <p className="text-[13px] font-semibold text-amber-800 mb-2">Таблица activity_log не создана</p>
            <p className="text-[12px] text-amber-700 mb-3">Выполни SQL-миграцию в Supabase SQL Editor:</p>
            <pre className="text-[11px] bg-white border border-amber-200 rounded-lg p-3 overflow-x-auto text-amber-900">{`CREATE TABLE IF NOT EXISTS activity_log (
  id         bigserial PRIMARY KEY,
  user_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  user_name  text,
  action     text NOT NULL,
  entity_type text,
  entity_id  text,
  details    jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_actlog_created ON activity_log(created_at DESC);`}</pre>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#f8f8f7] p-6">
      <div className="max-w-5xl mx-auto">

        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-[18px] font-semibold text-[#111110]">Лог действий</h1>
            <p className="text-[12px] text-[#9a9a95] mt-0.5">История всех действий в системе</p>
          </div>
          <button onClick={loadLog} className="px-3 py-1.5 text-[12px] border border-[#e4e4e0] rounded-lg text-[#6b6b66] hover:bg-[#f5f5f3]">
            Обновить
          </button>
        </div>

        {/* Фильтры */}
        <div className="flex gap-2 mb-4">
          <select
            value={filterAction}
            onChange={e => setFilterAction(e.target.value)}
            className="h-8 border border-[#e4e4e0] rounded-lg px-2.5 text-[12px] outline-none focus:border-[#9a9a95] bg-white text-[#4b4b47]">
            <option value="">Все действия</option>
            {uniqueActions.map(a => (
              <option key={a} value={a}>{ACTION_LABELS[a]?.label ?? a}</option>
            ))}
          </select>
          <input
            type="text" placeholder="Фильтр по сотруднику"
            value={filterUser}
            onChange={e => setFilterUser(e.target.value)}
            className="h-8 border border-[#e4e4e0] rounded-lg px-2.5 text-[12px] outline-none focus:border-[#9a9a95] bg-white w-52"
          />
          {(filterAction || filterUser) && (
            <button
              onClick={() => { setFilterAction(''); setFilterUser('') }}
              className="h-8 px-3 text-[12px] border border-[#e4e4e0] rounded-lg text-[#9a9a95] hover:bg-[#f5f5f3]">
              Сбросить
            </button>
          )}
          <span className="ml-auto text-[11px] text-[#9a9a95] self-center">{filtered.length} записей</span>
        </div>

        <div className="bg-white rounded-xl border border-[#e4e4e0] overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-[13px] text-[#9a9a95]">Загрузка...</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-[13px] text-[#9a9a95]">
              {entries.length === 0 ? 'Действий пока не зафиксировано' : 'Нет результатов по фильтру'}
            </div>
          ) : (
            <table className="w-full text-[12px]">
              <thead className="bg-[#fafaf9] border-b border-[#e4e4e0]">
                <tr>
                  <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest w-36">Дата</th>
                  <th className="text-left px-3 py-2.5 text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest w-28">Сотрудник</th>
                  <th className="text-left px-3 py-2.5 text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">Действие</th>
                  <th className="text-left px-3 py-2.5 text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest w-24">Объект</th>
                  <th className="text-left px-3 py-2.5 text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">Детали</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f8f8f7]">
                {filtered.map(entry => {
                  const meta = ACTION_LABELS[entry.action]
                  return (
                    <tr key={entry.id} className="hover:bg-[#fafaf9]">
                      <td className="px-4 py-2.5 text-[11px] text-[#9a9a95] font-mono whitespace-nowrap">
                        {fmtDate(entry.created_at)}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="text-[12px] font-medium text-[#111110]">
                          {entry.user_name ?? <span className="text-[#c4c4be] italic">система</span>}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${meta?.color ?? 'bg-[#f5f5f3] text-[#6b6b66]'}`}>
                          {meta?.label ?? entry.action}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-[11px] text-[#6b6b66]">
                        {entry.entity_type && (
                          <span>
                            <span className="text-[#9a9a95]">{entry.entity_type}</span>
                            {entry.entity_id && <span className="font-mono ml-1">#{entry.entity_id}</span>}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-[11px] text-[#6b6b66] max-w-xs">
                        {entry.details && (
                          <span className="font-mono text-[10px] text-[#9a9a95] truncate block" title={JSON.stringify(entry.details)}>
                            {JSON.stringify(entry.details).slice(0, 80)}
                            {JSON.stringify(entry.details).length > 80 ? '…' : ''}
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
