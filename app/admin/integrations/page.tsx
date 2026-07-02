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

interface BackfillResult {
  ok: boolean
  summary: {
    historyChecked:  number
    historyImported: number
    orphansFound:    number
    orphansQueued:   number
    failedReset:     number
    queueProcessed:  number
    errors:          string[]
  }
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
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [toast, setToast]             = useState<string | null>(null)
  const [rawOpen, setRawOpen]         = useState<string | null>(null)
  const [health, setHealth]           = useState<Record<string, unknown> | null>(null)
  const [healthLoading, setHealthLoading] = useState(false)
  const [tab, setTab]                 = useState<'messages' | 'errors'>('messages')
  const [backfillLoading, setBackfillLoading] = useState(false)
  const [backfillResult, setBackfillResult]   = useState<BackfillResult | null>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/integrations')
    if (res.status === 403) { setForbidden(true); setLoading(false); return }
    if (res.ok) setData(await res.json())
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  async function action(body: Record<string, unknown>, label: string) {
    const key = JSON.stringify(body)
    setActionLoading(key)
    try {
      const res = await fetch('/api/admin/integrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (json.ok) { showToast(`✅ ${label}`); await load() }
      else showToast(`❌ ${json.error ?? 'Ошибка'}`)
    } finally {
      setActionLoading(null)
    }
  }

  async function runHealth() {
    setHealthLoading(true)
    try {
      const res = await fetch('/api/integrations/avito/health')
      setHealth(await res.json())
    } finally {
      setHealthLoading(false)
    }
  }

  async function runBackfill() {
    setBackfillLoading(true)
    setBackfillResult(null)
    try {
      const res  = await fetch('/api/admin/integrations/backfill', { method: 'POST' })
      const json = await res.json() as BackfillResult
      setBackfillResult(json)
      await load()
      if (json.ok) showToast(`✅ Импортировано ${json.summary.historyImported}, отправлено ${json.summary.queueProcessed} в AmoCRM`)
      else showToast(`⚠️ Завершено с ошибками`)
    } catch (e) {
      showToast(`❌ ${String(e)}`)
    } finally {
      setBackfillLoading(false)
    }
  }

  const stats = data?.stats
  const messages = data?.messages ?? []
  const errors = data?.errors ?? []

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center text-[13px] text-muted">
      Загрузка...
    </div>
  )

  if (forbidden) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <p className="text-[32px] mb-2">🔒</p>
        <p className="text-[16px] font-semibold text-ink">Нет доступа</p>
        <p className="text-[13px] text-muted mt-1">Этот раздел доступен только Владиславу</p>
      </div>
    </div>
  )

  return (
    <div className="max-w-[1100px] mx-auto px-6 py-8">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 bg-ink text-white text-[13px] px-4 py-2.5 rounded-xl shadow-lg z-50">
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-[20px] font-semibold text-ink tracking-tight">
            Интеграции — Avito / AmoCRM Monitor
          </h1>
          <p className="text-[13px] text-muted mt-0.5">
            Статус очереди сообщений и синхронизации с AmoCRM
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => action({ action: 'run_processor' }, 'Очередь запущена')}
            disabled={!!actionLoading}
            className="text-[13px] font-medium px-4 py-2 rounded-lg bg-[#0071e3] text-white hover:bg-[#0064cc] disabled:opacity-40 transition-colors"
          >
            ▶ Обработать очередь
          </button>
          <button
            onClick={load}
            disabled={loading}
            className="text-[13px] font-medium px-4 py-2 rounded-lg bg-surface border border-line text-ink hover:bg-canvas disabled:opacity-40 transition-colors"
          >
            ↻ Обновить
          </button>
        </div>
      </div>

      {/* Stats cards */}
      {stats && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mb-6">
          {([
            ['Получено',  stats.total_received,   'text-ink'],
            ['Ожидает',   stats.pending,           'text-yellow-600'],
            ['В AmoCRM',  stats.synced_to_amocrm + stats.ai_processed, 'text-green-600'],
            ['В очереди', stats.processing + stats.retry_scheduled,    'text-blue-600'],
            ['Ошибки',    stats.failed,            'text-red-600'],
            ['Повторы',   stats.retry_scheduled,   'text-orange-600'],
          ] as [string, number, string][]).map(([label, val, cls]) => (
            <div key={label} className="bg-surface border border-line rounded-xl p-4 text-center">
              <p className={`text-[24px] font-semibold ${cls}`}>{val}</p>
              <p className="text-[11px] text-muted mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── Backfill panel ── */}
      <div className="bg-surface border-2 border-[#0071e3] rounded-xl p-5 mb-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">
              🔄 Подгрузить непоставленные сообщения
            </h2>
            <p className="text-[13px] text-ink-soft mt-1 max-w-[520px]">
              Импортирует историю из ai_conversations, найдёт сообщения без записи в очереди,
              сбросит ошибки и обработает всю очередь — отправит в AmoCRM всё что не дошло.
            </p>
          </div>
          <button
            onClick={runBackfill}
            disabled={backfillLoading}
            className="shrink-0 flex items-center gap-2 text-[14px] font-semibold px-5 py-2.5 rounded-xl bg-[#0071e3] text-white hover:bg-[#0064cc] disabled:opacity-50 transition-colors whitespace-nowrap"
          >
            {backfillLoading ? (
              <>
                <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                Обрабатываю...
              </>
            ) : '🔄 Подгрузить и обработать'}
          </button>
        </div>

        {backfillResult && (
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-6 gap-3">
            {([
              ['Проверено (история)',   backfillResult.summary.historyChecked,  'text-gray-600'],
              ['Импортировано',         backfillResult.summary.historyImported, 'text-indigo-700'],
              ['Осиротевших найдено',   backfillResult.summary.orphansFound,    'text-yellow-700'],
              ['Добавлено в очередь',   backfillResult.summary.orphansQueued,   'text-blue-700'],
              ['Ошибок сброшено',       backfillResult.summary.failedReset,     'text-orange-700'],
              ['Отправлено в AmoCRM',   backfillResult.summary.queueProcessed,  'text-green-700'],
            ] as [string, number, string][]).map(([label, val, cls]) => (
              <div key={label} className="bg-canvas rounded-lg p-3 text-center">
                <p className={`text-[22px] font-semibold ${cls}`}>{val}</p>
                <p className="text-[11px] text-muted mt-0.5">{label}</p>
              </div>
            ))}
            {backfillResult.summary.errors.length > 0 && (
              <div className="col-span-6 mt-1">
                {backfillResult.summary.errors.map((e, i) => (
                  <p key={i} className="text-[12px] text-red-600 font-mono">{e}</p>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Health check */}
      <div className="bg-surface border border-line rounded-xl p-4 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[14px] font-semibold text-ink">Проверить интеграцию</h2>
          <button
            onClick={runHealth}
            disabled={healthLoading}
            className="text-[13px] font-medium px-4 py-2 rounded-lg border border-line hover:bg-canvas disabled:opacity-40 transition-colors"
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
            <div className="flex gap-4 text-[12px] text-muted">
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
              tab === t ? 'bg-ink text-white' : 'bg-surface border border-line text-ink hover:bg-canvas'
            }`}
          >
            {t === 'messages' ? `Сообщения (${messages.length})` : `Ошибки (${errors.length})`}
          </button>
        ))}
        {errors.length > 0 && (
          <button
            onClick={() => action({ action: 'retry_all_failed' }, 'Все ошибки поставлены в очередь')}
            disabled={!!actionLoading}
            className="ml-auto text-[13px] font-medium px-4 py-2 rounded-lg bg-red-50 border border-red-200 text-red-700 hover:bg-red-100 disabled:opacity-40 transition-colors"
          >
            Повторить все ошибки
          </button>
        )}
      </div>

      {/* Messages table */}
      {tab === 'messages' && (
        <div className="bg-surface border border-line rounded-xl overflow-hidden">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-line bg-canvas">
                <th className="px-4 py-3 text-left font-semibold text-muted text-[11px] uppercase tracking-wider">Время</th>
                <th className="px-4 py-3 text-left font-semibold text-muted text-[11px] uppercase tracking-wider">Чат</th>
                <th className="px-4 py-3 text-left font-semibold text-muted text-[11px] uppercase tracking-wider">Сообщение</th>
                <th className="px-4 py-3 text-left font-semibold text-muted text-[11px] uppercase tracking-wider">Статус</th>
                <th className="px-4 py-3 text-left font-semibold text-muted text-[11px] uppercase tracking-wider">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {messages.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted">Нет сообщений</td>
                </tr>
              )}
              {messages.map(msg => (
                <tr key={msg.id} className="hover:bg-subtle">
                  <td className="px-4 py-3 text-muted whitespace-nowrap">{fmt(msg.received_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <span>{channelIcon(msg.chat_type)}</span>
                      <div>
                        <p className="font-medium text-ink truncate max-w-[120px]">{msg.contact_name ?? msg.chat_id}</p>
                        <p className="text-[11px] text-muted">{msg.chat_type}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 max-w-[280px]">
                    <span className="mr-1">{msgTypeIcon(msg.message_type)}</span>
                    <span className="text-ink truncate">
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
                      {msg.queue && ['failed', 'retry_scheduled', 'synced_to_amocrm'].includes(msg.queue.status) && (
                        <button
                          onClick={() => action({ action: 'retry', queueId: msg.queue!.id }, 'Сообщение поставлено в очередь')}
                          disabled={actionLoading === JSON.stringify({ action: 'retry', queueId: msg.queue!.id })}
                          className="text-[12px] text-[#0071e3] hover:underline disabled:opacity-40"
                        >
                          Повторить
                        </button>
                      )}
                      <button
                        onClick={() => setRawOpen(rawOpen === msg.id ? null : msg.id)}
                        className="text-[12px] text-muted hover:text-ink"
                      >
                        {rawOpen === msg.id ? 'Скрыть' : 'Raw'}
                      </button>
                    </div>
                    {rawOpen === msg.id && (
                      <pre className="mt-2 p-3 bg-canvas rounded-lg text-[11px] text-ink max-w-[400px] overflow-auto max-h-[200px] whitespace-pre-wrap break-all">
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
            <div className="bg-surface border border-line rounded-xl p-8 text-center text-muted">
              Нет ошибок 🎉
            </div>
          )}
          {errors.map(err => (
            <div key={err.id} className="bg-surface border border-line rounded-xl p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <StatusBadge status={err.status} />
                    <span className="text-[12px] text-muted">
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
                <button
                  onClick={() => action({ action: 'retry', queueId: err.id }, 'Поставлено в очередь')}
                  disabled={!!actionLoading}
                  className="shrink-0 text-[13px] font-medium px-3 py-1.5 rounded-lg bg-[#0071e3] text-white hover:bg-[#0064cc] disabled:opacity-40 transition-colors"
                >
                  Повторить
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
