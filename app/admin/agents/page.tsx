'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase-browser'

type AgentSetting = {
  id: number
  agent_key: string
  name: string
  description: string | null
  enabled: boolean
  is_running: boolean
  schedule: string | null
  config: Record<string, unknown>
  memory: Record<string, unknown>
  last_run_at: string | null
  last_action_text: string | null
  total_runs: number
  updated_at: string
}

type AgentLog = {
  id: number
  agent_key: string
  level: string
  icon: string
  message: string
  meta: Record<string, unknown> | null
  ran_at: string
}

const AGENT_META: Record<string, {
  emoji: string
  color: string
  bg: string
  border: string
  badge: string
  badgeOff: string
}> = {
  ceo:        { emoji: '👔', color: 'text-slate-700',   bg: 'bg-slate-50',    border: 'border-slate-200',   badge: 'bg-slate-100 text-slate-700',     badgeOff: 'bg-gray-100 text-gray-400' },
  revenue:    { emoji: '💰', color: 'text-emerald-700', bg: 'bg-emerald-50',  border: 'border-emerald-200', badge: 'bg-emerald-100 text-emerald-700', badgeOff: 'bg-gray-100 text-gray-400' },
  analyst:    { emoji: '📊', color: 'text-blue-700',    bg: 'bg-blue-50',     border: 'border-blue-200',    badge: 'bg-blue-100 text-blue-700',       badgeOff: 'bg-gray-100 text-gray-400' },
  production: { emoji: '🏭', color: 'text-orange-700',  bg: 'bg-orange-50',   border: 'border-orange-200',  badge: 'bg-orange-100 text-orange-700',   badgeOff: 'bg-gray-100 text-gray-400' },
  catalog:    { emoji: '🧠', color: 'text-violet-700',  bg: 'bg-violet-50',   border: 'border-violet-200',  badge: 'bg-violet-100 text-violet-700',   badgeOff: 'bg-gray-100 text-gray-400' },
}

const SCHEDULE_LABEL: Record<string, string> = {
  '0 * * * *':    'каждый час',
  '0 */6 * * *':  'каждые 6ч',
  '0 9 * * *':    'раз в день (9:00)',
  '* * * * *':    'каждую минуту',
}

function fmtTime(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  const now = new Date()
  const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000)
  if (diffMin < 1)   return 'только что'
  if (diffMin < 60)  return `${diffMin} мин назад`
  if (diffMin < 1440) return `${Math.floor(diffMin / 60)}ч назад`
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function fmtLogTime(iso: string) {
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

function levelColor(level: string) {
  switch (level) {
    case 'success': return 'text-emerald-600'
    case 'error':   return 'text-red-500'
    case 'warn':    return 'text-amber-600'
    case 'skip':    return 'text-gray-400'
    case 'idle':    return 'text-gray-400'
    default:        return 'text-[#4b4b47]'
  }
}

export default function AgentsPage() {
  const [agents, setAgents]       = useState<AgentSetting[]>([])
  const [logs, setLogs]           = useState<AgentLog[]>([])
  const [loading, setLoading]     = useState(true)
  const [running, setRunning]     = useState<Record<string, boolean>>({})
  const [toggling, setToggling]   = useState<Record<string, boolean>>({})
  const [expanded, setExpanded]   = useState<Record<string, boolean>>({})
  const [lastRefresh, setLastRefresh] = useState(new Date())

  const load = useCallback(async () => {
    const sb = createClient()
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const [{ data: a }, { data: l }] = await Promise.all([
      sb.from('agent_settings').select('*').order('id'),
      sb.from('agent_logs').select('*')
        .gte('ran_at', todayStart.toISOString())
        .order('ran_at', { ascending: false })
        .limit(100),
    ])
    setAgents((a ?? []) as AgentSetting[])
    setLogs((l ?? []) as AgentLog[])
    setLastRefresh(new Date())
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
    const interval = setInterval(load, 30_000)
    return () => clearInterval(interval)
  }, [load])

  async function toggle(agent: AgentSetting) {
    setToggling(p => ({ ...p, [agent.agent_key]: true }))
    const sb = createClient()
    await sb.from('agent_settings')
      .update({ enabled: !agent.enabled, updated_at: new Date().toISOString() })
      .eq('agent_key', agent.agent_key)
    await load()
    setToggling(p => ({ ...p, [agent.agent_key]: false }))
  }

  async function runNow(agent: AgentSetting) {
    setRunning(p => ({ ...p, [agent.agent_key]: true }))
    try {
      const res = await fetch(`/api/agents/run/${agent.agent_key}`, { method: 'POST' })
      const data = await res.json()
      await load()
      if (!data.ok && !data.skipped) console.warn('agent run:', data)
    } catch (e) {
      console.error(e)
    }
    setRunning(p => ({ ...p, [agent.agent_key]: false }))
  }

  if (loading) return (
    <div className="min-h-screen bg-[#f7f7f6] flex items-center justify-center">
      <div className="flex items-center gap-2 text-[#9a9a95] text-xs">
        <div className="w-4 h-4 border-2 border-[#d0d0cc] border-t-[#9a9a95] rounded-full animate-spin" />
        Загрузка AI-команды...
      </div>
    </div>
  )

  const activeCount  = agents.filter(a => a.enabled).length
  const runningCount = agents.filter(a => a.is_running).length
  const lastAny      = agents.reduce<string | null>((acc, a) => {
    if (!a.last_run_at) return acc
    if (!acc || a.last_run_at > acc) return a.last_run_at
    return acc
  }, null)

  return (
    <div className="min-h-screen bg-[#f7f7f6]">
      <div className="max-w-5xl mx-auto px-4 py-4">

        {/* Header */}
        <div className="flex items-start justify-between mb-5">
          <div>
            <h1 className="text-base font-semibold text-[#111110]">AI-команда MGlass</h1>
            <p className="text-xs text-[#9a9a95] mt-0.5">
              {activeCount} из {agents.length} активны
              {runningCount > 0 && <span className="text-emerald-600"> · {runningCount} работает сейчас</span>}
              {lastAny && <span> · последний запуск {fmtTime(lastAny)}</span>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-[#9a9a95]">обновлено {fmtLogTime(lastRefresh.toISOString())}</span>
            <button onClick={load}
              className="h-7 px-2.5 rounded-lg text-[11px] border border-[#e8e8e5] text-[#6b6b66] hover:bg-white transition-colors">
              ↻ Обновить
            </button>
          </div>
        </div>

        {/* Grid 2×2 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-6">
          {agents.map(agent => {
            const meta    = AGENT_META[agent.agent_key] ?? AGENT_META.analyst
            const isRun   = running[agent.agent_key]
            const isTogg  = toggling[agent.agent_key]
            const isExp   = expanded[agent.agent_key]
            const agLogs  = logs.filter(l => l.agent_key === agent.agent_key)
            const visLogs = isExp ? agLogs.slice(0, 20) : agLogs.slice(0, 5)
            const schedLabel = agent.schedule ? (SCHEDULE_LABEL[agent.schedule] ?? agent.schedule) : '—'

            return (
              <div key={agent.agent_key}
                className="bg-white rounded-xl border border-[#e8e8e5] overflow-hidden flex flex-col">

                {/* Card header */}
                <div className={`px-4 pt-4 pb-3 ${agent.enabled ? '' : 'opacity-60'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      {/* Avatar */}
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-2xl flex-shrink-0 ${meta.bg} border ${meta.border}`}>
                        {meta.emoji}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold text-[#111110]">{agent.name}</p>
                          {agent.is_running ? (
                            <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                              РАБОТАЕТ
                            </span>
                          ) : (
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${agent.enabled ? meta.badge : meta.badgeOff}`}>
                              {agent.enabled ? '● АКТИВЕН' : '○ ПАУЗА'}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-[#6b6b66] mt-0.5 leading-snug">{agent.description}</p>
                        <div className="flex items-center gap-3 mt-1 text-[10px] text-[#9a9a95]">
                          <span>⏱ {schedLabel}</span>
                          <span>▶ {agent.total_runs} запусков</span>
                          {agent.last_run_at && <span>последний: {fmtTime(agent.last_run_at)}</span>}
                        </div>
                      </div>
                    </div>

                    {/* Toggle */}
                    <button onClick={() => toggle(agent)} disabled={isTogg}
                      className={`w-11 h-6 rounded-full transition-all relative flex-shrink-0 mt-1 disabled:opacity-50 ${agent.enabled ? 'bg-emerald-500' : 'bg-[#d0d0cc]'}`}>
                      <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${agent.enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                    </button>
                  </div>

                  {/* Last action */}
                  {agent.last_action_text && (
                    <div className="mt-2.5 px-2.5 py-1.5 bg-[#f7f7f6] rounded-lg">
                      <p className="text-[11px] text-[#4b4b47] leading-snug">{agent.last_action_text}</p>
                    </div>
                  )}

                  {/* Memory stats */}
                  {Object.keys(agent.memory).length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {Object.entries(agent.memory).slice(0, 4).map(([k, v]) => (
                        <span key={k} className="text-[10px] px-2 py-0.5 bg-[#f0f0ee] rounded text-[#6b6b66] font-mono">
                          {k}: {String(v)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Log */}
                {agLogs.length > 0 && (
                  <div className="border-t border-[#f0f0ee] px-4 py-2 flex-1">
                    <div className="space-y-0.5">
                      {visLogs.map(log => (
                        <div key={log.id} className="flex items-start gap-2 py-0.5">
                          <span className="text-[10px] text-[#b8b8b4] flex-shrink-0 w-9 font-mono mt-px">{fmtLogTime(log.ran_at)}</span>
                          <span className="text-[11px] flex-shrink-0">{log.icon}</span>
                          <span className={`text-[11px] leading-snug flex-1 min-w-0 ${levelColor(log.level)}`}>{log.message}</span>
                        </div>
                      ))}
                    </div>
                    {agLogs.length > 5 && (
                      <button onClick={() => setExpanded(p => ({ ...p, [agent.agent_key]: !isExp }))}
                        className="mt-1.5 text-[10px] text-[#9a9a95] hover:text-[#4b4b47] transition-colors">
                        {isExp ? '↑ Свернуть' : `↓ Ещё ${agLogs.length - 5} записей`}
                      </button>
                    )}
                  </div>
                )}
                {agLogs.length === 0 && (
                  <div className="border-t border-[#f0f0ee] px-4 py-3">
                    <p className="text-[11px] text-[#b8b8b4] italic">Сегодня ещё не запускался</p>
                  </div>
                )}

                {/* Actions */}
                <div className="border-t border-[#f0f0ee] px-4 py-2.5 flex items-center justify-between">
                  <span className="text-[10px] text-[#9a9a95]">
                    {agent.schedule ? `следующий: по расписанию (${schedLabel})` : 'только ручной запуск'}
                  </span>
                  <button onClick={() => runNow(agent)} disabled={isRun || agent.is_running}
                    className="h-7 px-3 rounded-lg text-[11px] font-medium border border-[#e8e8e5] text-[#4b4b47] hover:bg-[#f5f5f3] disabled:opacity-40 transition-colors flex items-center gap-1.5">
                    {isRun || agent.is_running
                      ? <><span className="w-3 h-3 border border-[#9a9a95] border-t-transparent rounded-full animate-spin" />Работает...</>
                      : <>▶ Запустить</>
                    }
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        {/* Global feed */}
        <div className="bg-white rounded-xl border border-[#e8e8e5] overflow-hidden">
          <div className="px-4 py-3 border-b border-[#f0f0ee] flex items-center justify-between">
            <p className="text-[11px] font-semibold text-[#a8a8a3] uppercase tracking-wide">Лента событий сегодня</p>
            <span className="text-[11px] text-[#9a9a95]">{logs.length} записей</span>
          </div>
          {logs.length === 0 ? (
            <p className="px-4 py-8 text-sm text-center text-[#9a9a95]">Агенты сегодня ещё не работали</p>
          ) : (
            <div className="divide-y divide-[#f7f7f7] max-h-80 overflow-y-auto">
              {logs.map(log => {
                const m = AGENT_META[log.agent_key]
                return (
                  <div key={log.id} className="flex items-start gap-3 px-4 py-2">
                    <span className="text-[10px] text-[#b8b8b4] font-mono w-9 flex-shrink-0 mt-px">{fmtLogTime(log.ran_at)}</span>
                    <span className="text-[11px] flex-shrink-0">{m?.emoji ?? '🤖'}</span>
                    <span className={`text-[10px] font-semibold flex-shrink-0 w-16 mt-px ${m?.color ?? 'text-[#6b6b66]'}`}>{log.agent_key}</span>
                    <span className="text-[11px] flex-shrink-0">{log.icon}</span>
                    <span className={`text-[11px] flex-1 min-w-0 leading-snug ${levelColor(log.level)}`}>{log.message}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
