'use client'

import { useEffect, useState, useCallback } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────
interface QueueItem {
  id: string
  status: string
  attempts: number
  last_error: string | null
  amo_lead_id: number | null
  created_at: string
  updated_at: string
  raw_message_id: string
}

interface RawMessage {
  id: string
  chat_id: string
  chat_type: string
  direction: string
  message_type: string
  text: string | null
  contact_name: string | null
  received_at: string
  processing_status: string
  error_message: string | null
  wazzup_message_id: string | null
  queue: QueueItem | null
}

interface Stats {
  total_received: number
  pending: number
  processing: number
  synced_to_amocrm: number
  ai_processed: number
  failed: number
  retry_scheduled: number
}

interface MonitorData {
  stats: Stats
  messages: RawMessage[]
  errors: QueueItem[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending:          { label: 'Ожидает',      color: 'bg-yellow-100 text-yellow-800' },
  processing:       { label: 'Обрабатывается', color: 'bg-blue-100 text-blue-800' },
  synced_to_amocrm: { label: 'В AmoCRM',     color: 'bg-green-100 text-green-800' },
  ai_processed:     { label: 'AI + AmoCRM',  color: 'bg-emerald-100 text-emerald-800' },
  failed:           { label: 'Ошибка',       color: 'bg-red-100 text-red-800' },
  retry_scheduled:  { label: 'Повтор',       color: 'bg-orange-100 text-orange-800' },
  done:             { label: 'Готово',       color: 'bg-gray-100 text-gray-600' },
}

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_LABELS[status] ?? { label: status, color: 'bg-gray-100 text-gray-600' }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${s.color}`}>
      {s.label}
    </span>
  )
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function channelIcon(chatType: string) {
  if (chatType === 'avito')     return '🏠'
  if (chatType === 'whatsapp')  return '💬'
  if (chatType === 'telegram')  return '✈️'
  return '📱'
}

function msgTypeIcon(t: string) {
  const m: Record<string, string> = { text: '💬', photo: '🖼️', audio: '🎵', video: '📹', file: '📎', unknown: '❓' }
  return m[t] ?? '📄'
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function IntegrationsMonitor() {
  const [data, setData]               = useState<MonitorData | null>(null)
  const [loading, setLoading]         = useState(true)
  const [forbidden, setForbidden]     = useState(false)
  const [rawOpen, setRawOpen]         = useState<string | null>(null)
  const [health, setHealth]           = useState<Record<string, unknown> | null>(null)
  const [healthLoading, setHealthLoading] = useState(false)
  const [tab, setTab]                 = useState<'messages' | 'errors'>('messages')

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/integrations')
    if (res.status === 403) { setForbidden(true); setLoading(false); return }
    if (res.ok) setData(await res.json())
    setLoading(false)
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load().catch(() => setLoading(false)) }, [load])

  async function runHealth() {
    setHealthLoading(true)
    try {
      const res = await fetch('/api/integrations/avito/health')
      setHealth(await res.json())
    } finally {
      setHealthLoading(false)
    }
  }

  const stats = data?.stats
  const messages = data?.messages ?? []
  const errors = data?.errors ?? []

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center text-[13px] text-[#8a8a85]">
      Загрузка...
    </div>
  )

  if (forbidden) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <p className="text-[32px] mb-2">🔒</p>
        <p className="text-[16px] font-semibold text-[#111110]">Нет доступа</p>
        <p className="text-[13px] text-[#8a8a85] mt-1">Этот раздел доступен только Владиславу</p>
      </div>
    </div>
  )

  return (
    <div className="max-w-[1100px] mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-[20px] font-semibold text-[#111110] tracking-tight">
            Интеграции — архив очереди Авито
          </h1>
          <p className="text-[13px] text-[#8a8a85] mt-0.5">
            Очередь до 13.10.2026: тогда сообщения уходили заметками в AmoCRM. Сейчас AmoCRM только на чтение,
            новые сообщения пишутся во «входящие события» приложения.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={load}
            disabled={loading}
            className="text-[13px] font-medium px-4 py-2 rounded-lg bg-white border border-[#e4e4e0] text-[#111110] hover:bg-[#f5f5f4] disabled:opacity-40 transition-colors"
          >
            ↻ Обновить
          </button>
        </div>
      </div>

      {/* Stats cards */}
      {stats && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mb-6">
          {([
            ['Получено',  stats.total_received,   'text-[#111110]'],
            ['Ожидает',   stats.pending,           'text-yellow-600'],
            ['В AmoCRM',  stats.synced_to_amocrm + stats.ai_processed, 'text-green-600'],
            ['В очереди', stats.processing + stats.retry_scheduled,    'text-blue-600'],
            ['Ошибки',    stats.failed,            'text-red-600'],
            ['Повторы',   stats.retry_scheduled,   'text-orange-600'],
          ] as [string, number, string][]).map(([label, val, cls]) => (
            <div key={label} className="bg-white border border-[#e4e4e0] rounded-xl p-4 text-center">
              <p className={`text-[24px] font-bold ${cls}`}>{val}</p>
              <p className="text-[11px] text-[#8a8a85] mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Health check */}
      <div className="bg-white border border-[#e4e4e0] rounded-xl p-4 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[14px] font-semibold text-[#111110]">Проверить интеграцию</h2>
          <button
            onClick={runHealth}
            disabled={healthLoading}
            className="text-[13px] font-medium px-4 py-2 rounded-lg border border-[#e4e4e0] hover:bg-[#f5f5f4] disabled:opacity-40 transition-colors"
          >
            {healthLoading ? 'Проверяю...' : '🔍 Проверить'}
          </button>
        </div>
        {health && (
          <div className="space-y-2">
            <div className="flex items-center gap-6 flex-wrap">
              {Object.entries(health.checks as Record<string, { ok: boolean; error?: string }>).map(([name, v]) => (
                <div key={name} className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${v.ok ? 'bg-green-500' : 'bg-red-500'}`} />
                  <span className="text-[13px] capitalize">{name}</span>
                  {!v.ok && <span className="text-[12px] text-red-600">{v.error}</span>}
                </div>
              ))}
            </div>
            <div className="flex gap-4 text-[12px] text-[#8a8a85]">
              {Object.entries(health.queue as Record<string, number>).map(([k, v]) => (
                <span key={k}>{k}: <strong>{v}</strong></span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4">
        {(['messages', 'errors'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`text-[13px] font-medium px-4 py-2 rounded-lg transition-colors ${
              tab === t ? 'bg-[#111110] text-white' : 'bg-white border border-[#e4e4e0] text-[#111110] hover:bg-[#f5f5f4]'
            }`}
          >
            {t === 'messages' ? `Сообщения (${messages.length})` : `Ошибки (${errors.length})`}
          </button>
        ))}
      </div>

      {/* Messages table */}
      {tab === 'messages' && (
        <div className="bg-white border border-[#e4e4e0] rounded-xl overflow-hidden">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[#e4e4e0] bg-[#f8f8f7]">
                <th className="px-4 py-3 text-left font-semibold text-[#8a8a85] text-[11px] uppercase tracking-wider">Время</th>
                <th className="px-4 py-3 text-left font-semibold text-[#8a8a85] text-[11px] uppercase tracking-wider">Чат</th>
                <th className="px-4 py-3 text-left font-semibold text-[#8a8a85] text-[11px] uppercase tracking-wider">Сообщение</th>
                <th className="px-4 py-3 text-left font-semibold text-[#8a8a85] text-[11px] uppercase tracking-wider">Статус</th>
                <th className="px-4 py-3 text-left font-semibold text-[#8a8a85] text-[11px] uppercase tracking-wider">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f0f0ee]">
              {messages.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-[#8a8a85]">Нет сообщений</td>
                </tr>
              )}
              {messages.map(msg => (
                <tr key={msg.id} className="hover:bg-[#fafaf9]">
                  <td className="px-4 py-3 text-[#8a8a85] whitespace-nowrap">{fmt(msg.received_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <span>{channelIcon(msg.chat_type)}</span>
                      <div>
                        <p className="font-medium text-[#111110] truncate max-w-[120px]">{msg.contact_name ?? msg.chat_id}</p>
                        <p className="text-[11px] text-[#8a8a85]">{msg.chat_type}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 max-w-[280px]">
                    <span className="mr-1">{msgTypeIcon(msg.message_type)}</span>
                    <span className="text-[#111110] truncate">
                      {msg.text ? (msg.text.length > 60 ? msg.text.slice(0, 60) + '…' : msg.text) : `[${msg.message_type}]`}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {msg.queue ? (
                      <StatusBadge status={msg.queue.status} />
                    ) : (
                      <StatusBadge status={msg.processing_status} />
                    )}
                    {msg.queue?.last_error && (
                      <p className="text-[11px] text-red-600 mt-0.5 max-w-[180px] truncate" title={msg.queue.last_error}>
                        {msg.queue.last_error}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {msg.queue?.amo_lead_id && (
                        <a
                          href={`https://${process.env.NEXT_PUBLIC_AMO_SUBDOMAIN ?? 'mglass'}.amocrm.ru/leads/detail/${msg.queue.amo_lead_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[12px] text-[#0071e3] hover:underline whitespace-nowrap"
                        >
                          Сделка ↗
                        </a>
                      )}
                      <button
                        onClick={() => setRawOpen(rawOpen === msg.id ? null : msg.id)}
                        className="text-[12px] text-[#8a8a85] hover:text-[#111110]"
                      >
                        {rawOpen === msg.id ? 'Скрыть' : 'Raw'}
                      </button>
                    </div>
                    {rawOpen === msg.id && (
                      <pre className="mt-2 p-3 bg-[#f8f8f7] rounded-lg text-[11px] text-[#111110] max-w-[400px] overflow-auto max-h-[200px] whitespace-pre-wrap break-all">
                        {JSON.stringify(msg, null, 2)}
                      </pre>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Errors tab */}
      {tab === 'errors' && (
        <div className="space-y-3">
          {errors.length === 0 && (
            <div className="bg-white border border-[#e4e4e0] rounded-xl p-8 text-center text-[#8a8a85]">
              Нет ошибок 🎉
            </div>
          )}
          {errors.map(err => (
            <div key={err.id} className="bg-white border border-[#e4e4e0] rounded-xl p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <StatusBadge status={err.status} />
                    <span className="text-[12px] text-[#8a8a85]">
                      Попытка {err.attempts} · {fmt(err.updated_at)}
                    </span>
                    {err.amo_lead_id && (
                      <a
                        href={`https://mglass.amocrm.ru/leads/detail/${err.amo_lead_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[12px] text-[#0071e3] hover:underline"
                      >
                        Сделка #{err.amo_lead_id} ↗
                      </a>
                    )}
                  </div>
                  {err.last_error && (
                    <p className="text-[13px] text-red-700 bg-red-50 px-3 py-2 rounded-lg font-mono break-all">
                      {err.last_error}
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
