'use client'

import { useState, useRef } from 'react'

type CallItem = {
  note_id:       number
  direction:     'in' | 'out'
  created_at:    number
  phone:         string
  duration_sec:  number
  recording_url: string | null
  is_analysed:   boolean
  summary:       string | null
  probability:   number | null
  manager_score: number | null
  analysed_at:   string | null
}

type AnalysisResult = {
  transcription:       string
  summary:             string
  client_needs:        string[]
  objections:          string[]
  recommended_message: string
  tasks:               string[]
  next_step:           string
  deal_probability:    number
  manager_score:       number
  manager_feedback:    string
  sizes?:              string | null
  product_interest?:   string
}

function fmtDur(sec: number) {
  if (!sec) return '—'
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return m > 0 ? `${m} мин ${s} сек` : `${s} сек`
}

function fmtDate(ts: number) {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleDateString('ru-RU', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

function ScoreBadge({ score }: { score: number }) {
  const cls = score >= 8 ? 'bg-emerald-100 text-emerald-700'
    : score >= 5 ? 'bg-amber-100 text-amber-700'
    : 'bg-red-100 text-red-600'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${cls}`}>
      {score}/10
    </span>
  )
}

function ProbBadge({ prob }: { prob: number }) {
  const cls = prob >= 70 ? 'bg-emerald-100 text-emerald-700'
    : prob >= 40 ? 'bg-amber-100 text-amber-700'
    : 'bg-red-100 text-red-600'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${cls}`}>
      {prob}%
    </span>
  )
}

export default function CallsPage() {
  const [leadInput, setLeadInput]       = useState('')
  const [leadId, setLeadId]             = useState<number | null>(null)
  const [calls, setCalls]               = useState<CallItem[]>([])
  const [loadingCalls, setLoadingCalls] = useState(false)
  const [callsError, setCallsError]     = useState<string | null>(null)

  const [selected, setSelected]         = useState<CallItem | null>(null)
  const [manualText, setManualText]     = useState('')
  const [analyzing, setAnalyzing]       = useState(false)
  const [analyzeStep, setAnalyzeStep]   = useState<string>('')
  const [analyzeError, setAnalyzeError] = useState<string | null>(null)
  const [result, setResult]             = useState<AnalysisResult | null>(null)
  const [copied, setCopied]             = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const fileInputRef                    = useRef<HTMLInputElement>(null)

  async function loadCalls() {
    const id = parseInt(leadInput.trim().replace(/^#/, ''))
    if (!id) { setCallsError('Введите корректный ID сделки'); return }
    setLeadId(id)
    setLoadingCalls(true)
    setCallsError(null)
    setCalls([])
    setSelected(null)
    setResult(null)

    try {
      const res = await fetch(`/api/amo/calls?lead_id=${id}`)
      const data = await res.json()
      if (!res.ok) { setCallsError(data.error ?? 'Ошибка загрузки'); return }
      setCalls(data.calls ?? [])
      if (!data.calls?.length) setCallsError('Звонков в этой сделке нет. Попробуйте другой ID — используйте сделку, в которой были звонки через АТС.')
    } catch (err) {
      setCallsError(String(err))
    } finally {
      setLoadingCalls(false)
    }
  }

  async function analyzeCall(call: CallItem) {
    setSelected(call)
    setResult(null)
    setAnalyzeError(null)
    setManualText('')
    setAnalyzing(true)

    try {
      setAnalyzeStep(call.recording_url ? '🎵 Скачиваю запись...' : '⏳ Подготовка...')
      const res = await fetch('/api/amo/calls/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lead_id:       leadId,
          note_id:       call.note_id,
          direction:     call.direction,
          duration_sec:  call.duration_sec,
          phone:         call.phone,
          recording_url: call.recording_url,
          call_date:     call.created_at,
        }),
      })

      // Start showing progress after response comes back
      setAnalyzeStep('🤖 Анализирую с Claude...')

      const data = await res.json()
      if (res.status === 422 && data.error === 'no_transcription') {
        setAnalyzeError('no_transcription')
        setAnalyzing(false)
        return
      }
      if (!res.ok) { setAnalyzeError(data.error ?? 'Ошибка анализа'); setAnalyzing(false); return }
      setResult(data.analysis)
      setAnalyzeStep('')
      await refreshCalls()
    } catch (err) {
      setAnalyzeError(String(err))
    } finally {
      setAnalyzing(false)
      setAnalyzeStep('')
    }
  }

  async function analyzeWithManual() {
    if (!selected || !manualText.trim()) return
    setAnalyzing(true)
    setAnalyzeError(null)

    try {
      const res = await fetch('/api/amo/calls/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lead_id:       leadId,
          note_id:       selected.note_id,
          direction:     selected.direction,
          duration_sec:  selected.duration_sec,
          phone:         selected.phone,
          recording_url: selected.recording_url,
          call_date:     selected.created_at,
          transcription: manualText.trim(),
        }),
      })
      const data = await res.json()
      if (!res.ok) { setAnalyzeError(data.error ?? 'Ошибка'); return }
      setResult(data.analysis)
      setManualText('')
      await refreshCalls()
    } catch (err) {
      setAnalyzeError(String(err))
    } finally {
      setAnalyzing(false)
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setTranscribing(true)
    try {
      const fd = new FormData()
      fd.append('audio', file)
      const res = await fetch('/api/amo/calls/transcribe', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) { alert('Ошибка расшифровки: ' + (data.error ?? 'unknown')); return }
      setManualText(data.transcription ?? '')
    } finally {
      setTranscribing(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function refreshCalls() {
    if (!leadId) return
    const res = await fetch(`/api/amo/calls?lead_id=${leadId}`)
    const data = await res.json()
    if (res.ok) setCalls(data.calls ?? [])
  }

  function copyMessage(text: string) {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-[22px] font-semibold text-[#1d1d1f]">Анализ звонков</h1>
        <p className="text-[13px] text-[#6e6e73]">Расшифровка и AI-анализ звонков из amoCRM</p>
      </div>

      {/* Lead ID input */}
      <div className="bg-white rounded-2xl border border-[#e8e8ed] p-5 mb-6">
        <p className="text-[12px] font-semibold text-[#6e6e73] uppercase tracking-wider mb-3">Сделка amoCRM</p>
        <div className="flex gap-3">
          <input
            type="text"
            value={leadInput}
            onChange={e => setLeadInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && loadCalls()}
            placeholder="ID сделки (например: 38584619 или #38584619)"
            className="flex-1 bg-[#f9f9fb] border border-[#e8e8ed] rounded-xl px-4 py-2.5 text-[14px] text-[#1d1d1f] outline-none focus:border-[#0071e3] transition-colors placeholder:text-[#c7c7cc]"
          />
          <button
            onClick={loadCalls}
            disabled={loadingCalls}
            className="px-5 py-2.5 rounded-xl bg-[#0071e3] text-white text-[13px] font-semibold hover:bg-[#0077ed] disabled:opacity-40 transition-colors"
          >
            {loadingCalls ? 'Загрузка...' : 'Загрузить'}
          </button>
        </div>
        {callsError && <p className="text-[12px] text-red-500 mt-2">{callsError}</p>}
      </div>

      {/* AMO link */}
      {leadId && (
        <div className="mb-4 flex items-center gap-3">
          <a
            href={`https://mglass.amocrm.ru/leads/detail/${leadId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-white border border-[#e8e8ed] text-[12px] text-[#0071e3] font-medium hover:border-[#0071e3] hover:shadow-sm transition-all"
          >
            <span>🔗</span>
            Открыть сделку #{leadId} в amoCRM
          </a>
        </div>
      )}

      {/* Calls list */}
      {calls.length > 0 && (
        <div className="bg-white rounded-2xl border border-[#e8e8ed] overflow-hidden mb-6">
          <div className="px-5 py-3.5 border-b border-[#f2f2f7]">
            <p className="text-[14px] font-semibold text-[#1d1d1f]">
              Звонки сделки #{leadId}
              <span className="ml-2 text-[12px] font-normal text-[#aeaeb2]">{calls.length} шт.</span>
            </p>
          </div>
          <div className="divide-y divide-[#f2f2f7]">
            {calls.map(call => (
              <div
                key={call.note_id}
                className={`px-5 py-3.5 flex items-center gap-4 hover:bg-[#f9f9fb] transition-colors ${
                  selected?.note_id === call.note_id ? 'bg-[#f0f7ff]' : ''
                }`}
              >
                {/* Direction icon */}
                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-[16px] shrink-0 ${
                  call.direction === 'in' ? 'bg-emerald-100' : 'bg-blue-100'
                }`}>
                  {call.direction === 'in' ? '📞' : '📲'}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13px] font-medium text-[#1d1d1f]">
                      {call.direction === 'in' ? 'Входящий' : 'Исходящий'}
                    </span>
                    {call.phone && (
                      <span className="text-[12px] text-[#6e6e73]">{call.phone}</span>
                    )}
                    {call.is_analysed && (
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                        ✓ Проанализирован
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className="text-[11px] text-[#aeaeb2]">{fmtDate(call.created_at)}</span>
                    <span className="text-[11px] text-[#aeaeb2]">{fmtDur(call.duration_sec)}</span>
                    {call.probability != null && <ProbBadge prob={call.probability} />}
                    {call.manager_score != null && <ScoreBadge score={call.manager_score} />}
                    {call.recording_url ? (
                      <span className="text-[11px] text-[#0071e3]">🎵 Запись есть</span>
                    ) : (
                      <span className="text-[11px] text-[#aeaeb2]">Без записи</span>
                    )}
                  </div>
                  {call.summary && (
                    <p className="text-[12px] text-[#6e6e73] mt-0.5 truncate">{call.summary}</p>
                  )}
                </div>

                <div className="shrink-0 text-right">
                  <button
                    onClick={() => analyzeCall(call)}
                    disabled={analyzing && selected?.note_id === call.note_id}
                    className="px-3.5 py-1.5 rounded-xl text-[12px] font-semibold transition-colors bg-[#f2f2f7] text-[#1d1d1f] hover:bg-[#e8e8ed] disabled:opacity-40"
                  >
                    {analyzing && selected?.note_id === call.note_id ? '...' : call.is_analysed ? 'Повторить' : 'Анализ'}
                  </button>
                  {analyzing && selected?.note_id === call.note_id && analyzeStep && (
                    <p className="text-[10px] text-[#0071e3] mt-1 font-medium">{analyzeStep}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Manual transcription fallback */}
      {analyzeError === 'no_transcription' && selected && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 mb-6">
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="text-[14px] font-semibold text-amber-800">Запись недоступна с сервера</p>
              <p className="text-[12px] text-amber-600 mt-0.5">onpbx.ru закрыт по IP — скачай файл и загрузи сюда</p>
            </div>
            {selected.recording_url && (
              <a
                href={selected.recording_url}
                download
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-600 text-white text-[12px] font-semibold hover:bg-amber-700 transition-colors"
              >
                ↓ Скачать запись
              </a>
            )}
          </div>

          {/* File upload → auto-transcribe */}
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac"
            className="hidden"
            onChange={handleFileUpload}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={transcribing}
            className="w-full mb-4 py-2.5 rounded-xl border-2 border-dashed border-amber-300 text-[13px] text-amber-700 font-medium hover:bg-amber-100 disabled:opacity-50 transition-colors"
          >
            {transcribing ? '🎵 Расшифровываю через Whisper...' : '📂 Загрузить аудио файл → авто-расшифровка'}
          </button>

          <div className="relative mb-3">
            <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 border-t border-amber-200" />
            <span className="relative bg-amber-50 px-2 text-[11px] text-amber-500 mx-auto block w-fit">или вставьте текст вручную</span>
          </div>

          <textarea
            value={manualText}
            onChange={e => setManualText(e.target.value)}
            placeholder="Вставьте текст расшифровки разговора..."
            rows={5}
            className="w-full resize-none bg-white border border-amber-300 rounded-xl px-4 py-3 text-[13px] text-[#1d1d1f] outline-none focus:border-amber-500 transition-colors placeholder:text-[#c7c7cc] mb-3"
          />
          <div className="flex gap-2">
            <button
              onClick={analyzeWithManual}
              disabled={!manualText.trim() || analyzing}
              className="flex-1 py-2 rounded-xl bg-amber-600 text-white text-[13px] font-semibold hover:bg-amber-700 disabled:opacity-40 transition-colors"
            >
              {analyzing ? 'Анализирую...' : 'Проанализировать'}
            </button>
            <button
              onClick={() => { setAnalyzeError(null); setSelected(null) }}
              className="px-4 py-2 rounded-xl bg-[#f2f2f7] text-[#6e6e73] text-[13px] hover:bg-[#e8e8ed] transition-colors"
            >
              Отмена
            </button>
          </div>
        </div>
      )}

      {analyzeError && analyzeError !== 'no_transcription' && (
        <div className="bg-red-50 border border-red-200 rounded-2xl px-5 py-4 mb-6">
          <p className="text-[13px] text-red-600">Ошибка: {analyzeError}</p>
        </div>
      )}

      {/* Analysis result */}
      {result && (
        <div className="space-y-4">
          {/* Summary + scores */}
          <div className="bg-white rounded-2xl border border-[#e8e8ed] p-5">
            <div className="flex items-start justify-between gap-4 mb-3">
              <p className="text-[15px] font-semibold text-[#1d1d1f]">Резюме звонка</p>
              <div className="flex items-center gap-2 shrink-0">
                <ProbBadge prob={result.deal_probability} />
                <ScoreBadge score={result.manager_score} />
              </div>
            </div>
            <p className="text-[14px] text-[#3a3a3c] leading-relaxed">{result.summary}</p>
          </div>

          {/* Client needs + objections */}
          <div className="grid grid-cols-2 gap-4">
            {result.client_needs?.length > 0 && (
              <div className="bg-white rounded-2xl border border-[#e8e8ed] p-5">
                <p className="text-[12px] font-semibold text-[#6e6e73] uppercase tracking-wider mb-3">Потребности клиента</p>
                <ul className="space-y-1.5">
                  {result.client_needs.map((n, i) => (
                    <li key={i} className="flex items-start gap-2 text-[13px] text-[#1d1d1f]">
                      <span className="text-emerald-500 mt-0.5 shrink-0">•</span>
                      {n}
                    </li>
                  ))}
                </ul>
                {result.product_interest && result.product_interest !== 'не определено' && (
                  <p className="mt-3 text-[12px] text-[#6e6e73]">
                    Интерес: <span className="text-[#1d1d1f] font-medium">{result.product_interest}</span>
                  </p>
                )}
                {result.sizes && (
                  <p className="text-[12px] text-[#6e6e73]">
                    Размеры: <span className="text-[#1d1d1f] font-medium">{result.sizes}</span>
                  </p>
                )}
              </div>
            )}

            {result.objections?.length > 0 && (
              <div className="bg-white rounded-2xl border border-[#e8e8ed] p-5">
                <p className="text-[12px] font-semibold text-[#6e6e73] uppercase tracking-wider mb-3">Возражения</p>
                <ul className="space-y-1.5">
                  {result.objections.map((o, i) => (
                    <li key={i} className="flex items-start gap-2 text-[13px] text-[#1d1d1f]">
                      <span className="text-red-400 mt-0.5 shrink-0">•</span>
                      {o}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Recommended client message */}
          {result.recommended_message && (
            <div className="bg-white rounded-2xl border border-[#e8e8ed] p-5">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[12px] font-semibold text-[#6e6e73] uppercase tracking-wider">Сообщение клиенту</p>
                <button
                  onClick={() => copyMessage(result.recommended_message)}
                  className="text-[12px] text-[#0071e3] hover:underline"
                >
                  {copied ? '✓ Скопировано' : 'Скопировать'}
                </button>
              </div>
              <div className="bg-[#f0f7ff] rounded-xl px-4 py-3">
                <p className="text-[13px] text-[#1d1d1f] leading-relaxed whitespace-pre-wrap">{result.recommended_message}</p>
              </div>
            </div>
          )}

          {/* Tasks + next step */}
          {(result.tasks?.length > 0 || result.next_step) && (
            <div className="bg-white rounded-2xl border border-[#e8e8ed] p-5">
              <p className="text-[12px] font-semibold text-[#6e6e73] uppercase tracking-wider mb-3">Задачи и следующий шаг</p>
              {result.next_step && (
                <div className="flex items-start gap-2 mb-3">
                  <span className="text-[#0071e3] shrink-0 font-bold">→</span>
                  <p className="text-[13px] text-[#1d1d1f] font-medium">{result.next_step}</p>
                </div>
              )}
              {result.tasks?.length > 0 && (
                <ul className="space-y-1.5">
                  {result.tasks.map((t, i) => (
                    <li key={i} className="flex items-start gap-2 text-[13px] text-[#3a3a3c]">
                      <span className="text-[#aeaeb2] mt-0.5 shrink-0">☐</span>
                      {t}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Manager feedback */}
          {result.manager_feedback && (
            <div className="bg-white rounded-2xl border border-[#e8e8ed] p-5">
              <p className="text-[12px] font-semibold text-[#6e6e73] uppercase tracking-wider mb-3">
                Обратная связь менеджеру
                <span className="ml-2 normal-case font-normal text-[#aeaeb2]">оценка {result.manager_score}/10</span>
              </p>
              <p className="text-[13px] text-[#3a3a3c] leading-relaxed">{result.manager_feedback}</p>
            </div>
          )}

          {/* Transcription (collapsed) */}
          <details className="bg-white rounded-2xl border border-[#e8e8ed] overflow-hidden">
            <summary className="px-5 py-3.5 text-[13px] font-medium text-[#6e6e73] cursor-pointer hover:bg-[#f9f9fb] transition-colors select-none">
              Показать расшифровку
            </summary>
            <div className="px-5 pb-5">
              <p className="text-[13px] text-[#3a3a3c] leading-relaxed whitespace-pre-wrap">{result.summary}</p>
            </div>
          </details>
        </div>
      )}

      {/* Empty state before any search */}
      {!leadId && !loadingCalls && (
        <div className="text-center py-16">
          <div className="text-4xl mb-3">📞</div>
          <p className="text-[15px] font-medium text-[#1d1d1f] mb-1">Анализ звонков amoCRM</p>
          <p className="text-[13px] text-[#aeaeb2]">Введите ID сделки чтобы загрузить звонки</p>
        </div>
      )}
    </div>
  )
}
