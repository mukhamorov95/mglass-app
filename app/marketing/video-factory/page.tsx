'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  CONTENT_TYPE_LABELS, TOPIC_LABELS, GOAL_LABELS,
  type GeneratedScript,
} from '@/lib/contentGeneratorPrompt'

type Script = {
  id: number
  content_type: string
  topic: string
  goal: string
  context_input: string | null
  title: string | null
  hook: string | null
  structure: { time: string; label: string; visual: string; audio: string }[] | null
  narrator_text: string | null
  shots: { order: number; description: string; tip: string }[] | null
  b_roll: string[] | null
  editing_notes: string | null
  subtitle_moments: string[] | null
  cta: string | null
  description: string | null
  cover_idea: string | null
  telegram_post: string | null
  whatsapp_status: string | null
  b2b_version: string | null
  views_count: number
  leads_count: number
  saves_count: number
  platform_url: string | null
  status: string
  ai_generated: boolean
  created_at: string
}

const STATUS_STEPS = ['idea', 'script', 'filming', 'editing', 'published']
const STATUS_LABELS: Record<string, string> = {
  idea: 'Идея', script: 'Сценарий', filming: 'Съёмка', editing: 'Монтаж', published: 'Опубликован',
}
const STATUS_COLORS: Record<string, string> = {
  idea: 'bg-gray-100 text-gray-600',
  script: 'bg-blue-100 text-blue-700',
  filming: 'bg-amber-100 text-amber-700',
  editing: 'bg-purple-100 text-purple-700',
  published: 'bg-green-100 text-green-700',
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(() => {})
}

function ScriptCard({ script, onUpdate, onDelete }: {
  script: Script
  onUpdate: (id: number, fields: Partial<Script>) => void
  onDelete: (id: number) => void
}) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState('')

  function copy(label: string, text: string) {
    copyToClipboard(text)
    setCopied(label)
    setTimeout(() => setCopied(''), 1500)
  }

  function nextStatus() {
    const idx = STATUS_STEPS.indexOf(script.status)
    if (idx < STATUS_STEPS.length - 1) onUpdate(script.id, { status: STATUS_STEPS[idx + 1] })
  }

  return (
    <div className="bg-white border border-[#e4e4e0] rounded-xl overflow-hidden">
      <div className="px-4 py-3 flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[script.status] ?? 'bg-gray-100 text-gray-600'}`}>
              {STATUS_LABELS[script.status] ?? script.status}
            </span>
            {script.ai_generated && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 font-medium">AI</span>
            )}
            <span className="text-[11px] text-[#8a8a85]">{CONTENT_TYPE_LABELS[script.content_type] ?? script.content_type}</span>
            <span className="text-[11px] text-[#8a8a85]">· {TOPIC_LABELS[script.topic] ?? script.topic}</span>
          </div>
          <p className="text-[14px] font-semibold text-[#111110] leading-tight">{script.title ?? '—'}</p>
          {script.hook && <p className="text-[12px] text-[#6b6b66] mt-0.5 line-clamp-1">"{script.hook}"</p>}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {script.status !== 'published' && (
            <button onClick={nextStatus}
              className="text-[11px] px-2.5 py-1 rounded-lg bg-[#f4f4f0] text-[#6b6b66] hover:bg-[#e4e4e0] transition-colors">
              →
            </button>
          )}
          <button onClick={() => setOpen(o => !o)}
            className="text-[11px] px-2.5 py-1 rounded-lg border border-[#e4e4e0] text-[#6b6b66] hover:border-blue-300 hover:text-blue-700 transition-colors">
            {open ? 'Свернуть' : 'Открыть'}
          </button>
          <button onClick={() => onDelete(script.id)}
            className="text-[11px] px-2 py-1 rounded-lg text-red-400 hover:bg-red-50 transition-colors">
            ×
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-[#e4e4e0] px-4 py-4 space-y-4">
          {/* Stats */}
          <div className="flex gap-4 text-[12px] text-[#6b6b66]">
            <span>👁 {script.views_count} просмотров</span>
            <span>🎯 {script.leads_count} лидов</span>
            <span>🔖 {script.saves_count} сохранений</span>
          </div>

          {/* Structure */}
          {script.structure && script.structure.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-[#8a8a85] uppercase tracking-wider mb-2">Структура</p>
              <div className="space-y-1">
                {script.structure.map((s, i) => (
                  <div key={i} className="grid grid-cols-[80px_1fr_1fr] gap-2 text-[12px]">
                    <span className="text-[#8a8a85] font-mono">{s.time}</span>
                    <span className="text-[#111110]">{s.visual}</span>
                    <span className="text-[#6b6b66] italic">{s.audio}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Narrator */}
          {script.narrator_text && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <p className="text-[11px] font-semibold text-[#8a8a85] uppercase tracking-wider">Текст диктора</p>
                <button onClick={() => copy('narrator', script.narrator_text!)}
                  className="text-[11px] text-blue-600 hover:underline">
                  {copied === 'narrator' ? 'Скопировано!' : 'Копировать'}
                </button>
              </div>
              <pre className="text-[12px] text-[#111110] whitespace-pre-wrap bg-[#f8f8f6] rounded-lg p-3 font-sans leading-relaxed">
                {script.narrator_text}
              </pre>
            </div>
          )}

          {/* Shots */}
          {script.shots && script.shots.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-[#8a8a85] uppercase tracking-wider mb-2">Кадры</p>
              <div className="space-y-2">
                {script.shots.map((sh) => (
                  <div key={sh.order} className="flex gap-3 text-[12px]">
                    <span className="w-5 h-5 rounded-full bg-[#111110] text-white flex items-center justify-center text-[10px] flex-shrink-0 mt-0.5">
                      {sh.order}
                    </span>
                    <div>
                      <p className="text-[#111110]">{sh.description}</p>
                      <p className="text-[#8a8a85] text-[11px]">{sh.tip}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* B-roll */}
          {script.b_roll && script.b_roll.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-[#8a8a85] uppercase tracking-wider mb-2">B-roll</p>
              <div className="flex flex-wrap gap-2">
                {script.b_roll.map((b, i) => (
                  <span key={i} className="text-[11px] px-2 py-1 bg-[#f4f4f0] rounded-lg text-[#6b6b66]">{b}</span>
                ))}
              </div>
            </div>
          )}

          {/* Editing + Subtitles */}
          <div className="grid grid-cols-2 gap-4">
            {script.editing_notes && (
              <div>
                <p className="text-[11px] font-semibold text-[#8a8a85] uppercase tracking-wider mb-1">Монтаж</p>
                <p className="text-[12px] text-[#6b6b66]">{script.editing_notes}</p>
              </div>
            )}
            {script.subtitle_moments && script.subtitle_moments.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold text-[#8a8a85] uppercase tracking-wider mb-1">Субтитры</p>
                <ul className="space-y-0.5">
                  {script.subtitle_moments.map((sm, i) => (
                    <li key={i} className="text-[12px] text-[#6b6b66]">· {sm}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* CTA */}
          {script.cta && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <span className="text-[11px] font-semibold text-amber-700 uppercase tracking-wider">CTA: </span>
              <span className="text-[12px] text-amber-800">{script.cta}</span>
            </div>
          )}

          {/* Description */}
          {script.description && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <p className="text-[11px] font-semibold text-[#8a8a85] uppercase tracking-wider">Подпись Instagram/YouTube</p>
                <button onClick={() => copy('desc', script.description!)}
                  className="text-[11px] text-blue-600 hover:underline">
                  {copied === 'desc' ? 'Скопировано!' : 'Копировать'}
                </button>
              </div>
              <pre className="text-[12px] text-[#6b6b66] whitespace-pre-wrap bg-[#f8f8f6] rounded-lg p-3 font-sans">{script.description}</pre>
            </div>
          )}

          {/* Telegram + WhatsApp */}
          <div className="grid grid-cols-1 gap-3">
            {script.telegram_post && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[11px] font-semibold text-[#8a8a85] uppercase tracking-wider">Telegram пост</p>
                  <button onClick={() => copy('tg', script.telegram_post!)}
                    className="text-[11px] text-blue-600 hover:underline">
                    {copied === 'tg' ? 'Скопировано!' : 'Копировать'}
                  </button>
                </div>
                <pre className="text-[12px] text-[#6b6b66] whitespace-pre-wrap bg-[#f0f8ff] rounded-lg p-3 font-sans">{script.telegram_post}</pre>
              </div>
            )}
            {script.whatsapp_status && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[11px] font-semibold text-[#8a8a85] uppercase tracking-wider">WhatsApp статус</p>
                  <button onClick={() => copy('wa', script.whatsapp_status!)}
                    className="text-[11px] text-blue-600 hover:underline">
                    {copied === 'wa' ? 'Скопировано!' : 'Копировать'}
                  </button>
                </div>
                <pre className="text-[12px] text-[#6b6b66] whitespace-pre-wrap bg-[#f0fff4] rounded-lg p-3 font-sans">{script.whatsapp_status}</pre>
              </div>
            )}
          </div>

          {/* B2B version */}
          {script.b2b_version && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <p className="text-[11px] font-semibold text-[#8a8a85] uppercase tracking-wider">B2B версия</p>
                <button onClick={() => copy('b2b', script.b2b_version!)}
                  className="text-[11px] text-blue-600 hover:underline">
                  {copied === 'b2b' ? 'Скопировано!' : 'Копировать'}
                </button>
              </div>
              <pre className="text-[12px] text-[#6b6b66] whitespace-pre-wrap bg-[#faf8ff] rounded-lg p-3 font-sans">{script.b2b_version}</pre>
            </div>
          )}

          {/* Cover */}
          {script.cover_idea && (
            <div className="bg-[#f4f4f0] rounded-lg px-3 py-2">
              <span className="text-[11px] font-semibold text-[#8a8a85] uppercase tracking-wider">Обложка: </span>
              <span className="text-[12px] text-[#6b6b66]">{script.cover_idea}</span>
            </div>
          )}

          {/* Platform URL + analytics edit */}
          <div className="pt-2 border-t border-[#e4e4e0] flex gap-3 items-center">
            <input
              type="url"
              placeholder="Ссылка на опубликованное видео..."
              defaultValue={script.platform_url ?? ''}
              onBlur={e => onUpdate(script.id, { platform_url: e.target.value || null })}
              className="flex-1 text-[12px] border border-[#e4e4e0] rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-300"
            />
            <div className="flex gap-2 text-[11px]">
              <label className="flex items-center gap-1">
                <span className="text-[#8a8a85]">👁</span>
                <input type="number" min="0" defaultValue={script.views_count}
                  onBlur={e => onUpdate(script.id, { views_count: parseInt(e.target.value) || 0 })}
                  className="w-16 border border-[#e4e4e0] rounded px-1.5 py-1 focus:outline-none" />
              </label>
              <label className="flex items-center gap-1">
                <span className="text-[#8a8a85]">🎯</span>
                <input type="number" min="0" defaultValue={script.leads_count}
                  onBlur={e => onUpdate(script.id, { leads_count: parseInt(e.target.value) || 0 })}
                  className="w-12 border border-[#e4e4e0] rounded px-1.5 py-1 focus:outline-none" />
              </label>
              <label className="flex items-center gap-1">
                <span className="text-[#8a8a85]">🔖</span>
                <input type="number" min="0" defaultValue={script.saves_count}
                  onBlur={e => onUpdate(script.id, { saves_count: parseInt(e.target.value) || 0 })}
                  className="w-12 border border-[#e4e4e0] rounded px-1.5 py-1 focus:outline-none" />
              </label>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const GENERATION_STAGES = [
  { key: 'hook',       label: 'Хук', icon: '⚡' },
  { key: 'structure',  label: 'Структура', icon: '🗂' },
  { key: 'narrator',   label: 'Текст диктора', icon: '🎙' },
  { key: 'shots',      label: 'Кадры', icon: '🎬' },
  { key: 'b_roll',     label: 'B-roll', icon: '📹' },
  { key: 'cta',        label: 'CTA', icon: '📣' },
  { key: 'description',label: 'Описание', icon: '📝' },
  { key: 'telegram',   label: 'Telegram', icon: '✈️' },
  { key: 'whatsapp',   label: 'WhatsApp', icon: '💬' },
  { key: 'b2b',        label: 'B2B версия', icon: '🏢' },
  { key: 'cover',      label: 'Обложка', icon: '🖼' },
  { key: 'editing',    label: 'Монтаж', icon: '✂️' },
]

function GeneratorTab({ onSaved }: { onSaved: () => void }) {
  const [contentType, setContentType] = useState('reels')
  const [topic, setTopic] = useState('shower')
  const [goal, setGoal] = useState('leads')
  const [context, setContext] = useState('')
  const [loading, setLoading] = useState(false)
  const [streamText, setStreamText] = useState('')
  const [doneCount, setDoneCount] = useState(0)
  const [result, setResult] = useState<GeneratedScript | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState('')

  async function generate() {
    setLoading(true)
    setError('')
    setResult(null)
    setSaved(false)
    setStreamText('')
    setDoneCount(0)

    try {
      const res = await fetch('/api/ai/content-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'script', content_type: contentType, topic, goal, context, stream: true }),
      })
      if (!res.body) throw new Error('No stream body')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value)
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ') || line === 'data: [DONE]') continue
          try {
            const data = JSON.parse(line.slice(6))
            if (data.type === 'chunk') {
              setStreamText(prev => {
                const next = prev + data.text
                // count how many top-level keys we've seen closed in the JSON so far
                const matches = next.match(/"(hook|structure|narrator_text|shots|b_roll|cta|description|telegram_post|whatsapp_status|b2b_version|cover_idea|editing_notes)"\s*:/g)
                setDoneCount(matches ? matches.length : 0)
                return next
              })
            } else if (data.type === 'done') {
              setResult(data.result as GeneratedScript)
            } else if (data.type === 'error') {
              setError(data.error)
            }
          } catch {}
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setLoading(false)
    }
  }

  async function saveScript() {
    if (!result) return
    setSaving(true)
    try {
      const res = await fetch('/api/marketing/scripts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content_type: contentType,
          topic,
          goal,
          context_input: context || null,
          ai_generated: true,
          status: 'script',
          ...result,
        }),
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
        throw new Error(errData.error || `HTTP ${res.status}`)
      }
      setSaved(true)
      onSaved()
    } catch (e) {
      setError('Ошибка при сохранении: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setSaving(false)
    }
  }

  function copy(label: string, text: string) {
    copyToClipboard(text)
    setCopied(label)
    setTimeout(() => setCopied(''), 1500)
  }

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="bg-white border border-[#e4e4e0] rounded-xl p-5">
        <h2 className="text-[14px] font-semibold text-[#111110] mb-4">Настройки контента</h2>
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div>
            <label className="text-[11px] font-medium text-[#8a8a85] uppercase tracking-wider block mb-1.5">Формат</label>
            <select value={contentType} onChange={e => setContentType(e.target.value)}
              className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-300">
              {Object.entries(CONTENT_TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[11px] font-medium text-[#8a8a85] uppercase tracking-wider block mb-1.5">Тема</label>
            <select value={topic} onChange={e => setTopic(e.target.value)}
              className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-300">
              {Object.entries(TOPIC_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[11px] font-medium text-[#8a8a85] uppercase tracking-wider block mb-1.5">Цель</label>
            <select value={goal} onChange={e => setGoal(e.target.value)}
              className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-300">
              {Object.entries(GOAL_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="mb-4">
          <label className="text-[11px] font-medium text-[#8a8a85] uppercase tracking-wider block mb-1.5">
            Дополнительный контекст (необязательно)
          </label>
          <textarea
            value={context}
            onChange={e => setContext(e.target.value)}
            rows={2}
            placeholder="Конкретный проект, пожелания, особые акценты..."
            className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] resize-none focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
        </div>
        <button onClick={generate} disabled={loading}
          className="w-full py-3 bg-[#111110] text-white rounded-xl text-[13px] font-semibold hover:bg-[#333] disabled:opacity-50 transition-colors">
          {loading ? 'AI генерирует контент...' : 'Сгенерировать контент'}
        </button>
        {error && <p className="text-[12px] text-red-500 mt-2">{error}</p>}
      </div>

      {/* Loading state — live progress */}
      {loading && (
        <div className="bg-white border border-[#e4e4e0] rounded-xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex gap-1">
              {[0, 150, 300].map(d => (
                <span key={d} className="w-2 h-2 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: `${d}ms` }} />
              ))}
            </div>
            <p className="text-[13px] text-[#111110] font-medium">AI создаёт контент...</p>
            <span className="text-[11px] text-[#8a8a85]">{doneCount} / 12 элементов</span>
          </div>
          {/* Progress bar */}
          <div className="w-full bg-[#f4f4f0] rounded-full h-1.5 mb-4">
            <div
              className="bg-blue-500 h-1.5 rounded-full transition-all duration-300"
              style={{ width: `${Math.min((doneCount / 12) * 100, 95)}%` }}
            />
          </div>
          {/* Element chips */}
          <div className="flex flex-wrap gap-1.5">
            {GENERATION_STAGES.map((s, i) => (
              <span key={s.key} className={`text-[11px] px-2 py-0.5 rounded-full transition-colors ${
                i < doneCount
                  ? 'bg-blue-100 text-blue-700 font-medium'
                  : 'bg-[#f4f4f0] text-[#8a8a85]'
              }`}>
                {s.icon} {s.label}
              </span>
            ))}
          </div>
          {streamText.length > 100 && (
            <p className="text-[10px] text-[#8a8a85] mt-3">
              Получено символов: {streamText.length}
            </p>
          )}
        </div>
      )}

      {/* Result */}
      {result && !loading && (
        <div className="space-y-4">
          {/* Save bar */}
          <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 flex items-center justify-between">
            <div>
              <p className="text-[13px] font-semibold text-blue-800">{result.title}</p>
              <p className="text-[12px] text-blue-600">Контент сгенерирован. Сохранить в библиотеку?</p>
            </div>
            <button onClick={saveScript} disabled={saving || saved}
              className={`px-4 py-2 rounded-xl text-[12px] font-semibold transition-colors ${
                saved ? 'bg-green-500 text-white' : 'bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50'
              }`}>
              {saved ? 'Сохранено!' : saving ? 'Сохранение...' : 'Сохранить'}
            </button>
          </div>

          {/* Hook */}
          <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-semibold text-[#8a8a85] uppercase tracking-wider">Хук (первые слова)</p>
              <button onClick={() => copy('hook', result.hook)} className="text-[11px] text-blue-600 hover:underline">
                {copied === 'hook' ? 'Скопировано!' : 'Копировать'}
              </button>
            </div>
            <p className="text-[16px] font-bold text-[#111110] leading-tight">"{result.hook}"</p>
          </div>

          {/* Structure */}
          {result.structure && (
            <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
              <p className="text-[11px] font-semibold text-[#8a8a85] uppercase tracking-wider mb-3">Структура</p>
              <div className="space-y-2">
                {result.structure.map((s, i) => (
                  <div key={i} className="grid grid-cols-[90px_1fr_1fr] gap-3 text-[12px] py-1.5 border-b border-[#f4f4f0] last:border-0">
                    <div>
                      <span className="text-[#8a8a85] font-mono text-[11px]">{s.time}</span>
                      <p className="text-[#111110] font-medium">{s.label}</p>
                    </div>
                    <div>
                      <span className="text-[10px] text-[#8a8a85] uppercase">Картинка</span>
                      <p className="text-[#6b6b66]">{s.visual}</p>
                    </div>
                    <div>
                      <span className="text-[10px] text-[#8a8a85] uppercase">Звук</span>
                      <p className="text-[#6b6b66] italic">{s.audio}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Narrator */}
          <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-semibold text-[#8a8a85] uppercase tracking-wider">Текст диктора</p>
              <button onClick={() => copy('narrator', result.narrator_text)} className="text-[11px] text-blue-600 hover:underline">
                {copied === 'narrator' ? 'Скопировано!' : 'Копировать'}
              </button>
            </div>
            <pre className="text-[13px] text-[#111110] whitespace-pre-wrap font-sans leading-relaxed">{result.narrator_text}</pre>
          </div>

          {/* Shots */}
          {result.shots && (
            <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
              <p className="text-[11px] font-semibold text-[#8a8a85] uppercase tracking-wider mb-3">Кадры для съёмки</p>
              <div className="space-y-3">
                {result.shots.map(sh => (
                  <div key={sh.order} className="flex gap-3">
                    <span className="w-6 h-6 rounded-full bg-[#111110] text-white flex items-center justify-center text-[11px] font-bold flex-shrink-0">
                      {sh.order}
                    </span>
                    <div>
                      <p className="text-[13px] text-[#111110]">{sh.description}</p>
                      <p className="text-[11px] text-[#8a8a85] mt-0.5">{sh.tip}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* B-roll + Editing + Subtitles */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
              <p className="text-[11px] font-semibold text-[#8a8a85] uppercase tracking-wider mb-2">B-roll</p>
              <ul className="space-y-1">
                {result.b_roll.map((b, i) => <li key={i} className="text-[12px] text-[#6b6b66]">· {b}</li>)}
              </ul>
            </div>
            <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
              <p className="text-[11px] font-semibold text-[#8a8a85] uppercase tracking-wider mb-2">Монтаж</p>
              <p className="text-[12px] text-[#6b6b66]">{result.editing_notes}</p>
            </div>
            <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
              <p className="text-[11px] font-semibold text-[#8a8a85] uppercase tracking-wider mb-2">Субтитры</p>
              <ul className="space-y-1">
                {result.subtitle_moments.map((sm, i) => <li key={i} className="text-[12px] text-[#6b6b66]">· {sm}</li>)}
              </ul>
            </div>
          </div>

          {/* CTA */}
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <div className="flex items-center justify-between mb-1">
              <p className="text-[11px] font-semibold text-amber-700 uppercase tracking-wider">Призыв к действию (CTA)</p>
              <button onClick={() => copy('cta', result.cta)} className="text-[11px] text-amber-700 hover:underline">
                {copied === 'cta' ? 'Скопировано!' : 'Копировать'}
              </button>
            </div>
            <p className="text-[14px] text-amber-900 font-medium">{result.cta}</p>
          </div>

          {/* Description */}
          <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-semibold text-[#8a8a85] uppercase tracking-wider">Подпись Instagram/YouTube</p>
              <button onClick={() => copy('desc', result.description)} className="text-[11px] text-blue-600 hover:underline">
                {copied === 'desc' ? 'Скопировано!' : 'Копировать'}
              </button>
            </div>
            <pre className="text-[12px] text-[#6b6b66] whitespace-pre-wrap font-sans">{result.description}</pre>
          </div>

          {/* Cover */}
          <div className="bg-[#f4f4f0] rounded-xl p-4">
            <p className="text-[11px] font-semibold text-[#8a8a85] uppercase tracking-wider mb-1">Обложка / превью</p>
            <p className="text-[13px] text-[#111110]">{result.cover_idea}</p>
          </div>

          {/* Telegram + WhatsApp */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] font-semibold text-[#8a8a85] uppercase tracking-wider">Telegram пост</p>
                <button onClick={() => copy('tg', result.telegram_post)} className="text-[11px] text-blue-600 hover:underline">
                  {copied === 'tg' ? 'Скопировано!' : 'Копировать'}
                </button>
              </div>
              <pre className="text-[12px] text-[#6b6b66] whitespace-pre-wrap font-sans">{result.telegram_post}</pre>
            </div>
            <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] font-semibold text-[#8a8a85] uppercase tracking-wider">WhatsApp статус</p>
                <button onClick={() => copy('wa', result.whatsapp_status)} className="text-[11px] text-blue-600 hover:underline">
                  {copied === 'wa' ? 'Скопировано!' : 'Копировать'}
                </button>
              </div>
              <pre className="text-[12px] text-[#6b6b66] whitespace-pre-wrap font-sans">{result.whatsapp_status}</pre>
            </div>
          </div>

          {/* B2B */}
          <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-semibold text-[#8a8a85] uppercase tracking-wider">B2B версия</p>
              <button onClick={() => copy('b2b', result.b2b_version)} className="text-[11px] text-blue-600 hover:underline">
                {copied === 'b2b' ? 'Скопировано!' : 'Копировать'}
              </button>
            </div>
            <pre className="text-[12px] text-[#6b6b66] whitespace-pre-wrap font-sans">{result.b2b_version}</pre>
          </div>
        </div>
      )}
    </div>
  )
}

function LibraryTab() {
  const [scripts, setScripts] = useState<Script[]>([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState('')
  const [filterType, setFilterType] = useState('')

  const load = useCallback(async () => {
    const params = new URLSearchParams()
    if (filterStatus) params.set('status', filterStatus)
    if (filterType) params.set('content_type', filterType)
    const res = await fetch(`/api/marketing/scripts?${params}`)
    const data = await res.json()
    setScripts(Array.isArray(data) ? data : [])
    setLoading(false)
  }, [filterStatus, filterType])

  useEffect(() => { load() }, [load])

  async function update(id: number, fields: Partial<Script>) {
    await fetch('/api/marketing/scripts', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...fields }),
    })
    setScripts(prev => prev.map(s => s.id === id ? { ...s, ...fields } : s))
  }

  async function del(id: number) {
    await fetch('/api/marketing/scripts', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    setScripts(prev => prev.filter(s => s.id !== id))
  }

  const statusCounts = STATUS_STEPS.reduce((acc, s) => {
    acc[s] = scripts.filter(sc => sc.status === s).length
    return acc
  }, {} as Record<string, number>)

  return (
    <div className="space-y-4">
      {/* Stats bar */}
      <div className="flex gap-2 flex-wrap">
        <button onClick={() => setFilterStatus('')}
          className={`text-[12px] px-3 py-1.5 rounded-xl border transition-colors ${!filterStatus ? 'bg-[#111110] text-white border-[#111110]' : 'border-[#e4e4e0] text-[#6b6b66] hover:border-gray-400'}`}>
          Все ({scripts.length})
        </button>
        {STATUS_STEPS.map(s => (
          <button key={s} onClick={() => setFilterStatus(filterStatus === s ? '' : s)}
            className={`text-[12px] px-3 py-1.5 rounded-xl border transition-colors ${filterStatus === s ? 'bg-[#111110] text-white border-[#111110]' : 'border-[#e4e4e0] text-[#6b6b66] hover:border-gray-400'}`}>
            {STATUS_LABELS[s]} ({statusCounts[s] ?? 0})
          </button>
        ))}
      </div>

      {/* Type filter */}
      <div className="flex gap-2 flex-wrap">
        <button onClick={() => setFilterType('')}
          className={`text-[11px] px-2.5 py-1 rounded-lg border transition-colors ${!filterType ? 'bg-[#111110] text-white border-[#111110]' : 'border-[#e4e4e0] text-[#8a8a85]'}`}>
          Все форматы
        </button>
        {Object.entries(CONTENT_TYPE_LABELS).map(([k, v]) => (
          <button key={k} onClick={() => setFilterType(filterType === k ? '' : k)}
            className={`text-[11px] px-2.5 py-1 rounded-lg border transition-colors ${filterType === k ? 'bg-[#111110] text-white border-[#111110]' : 'border-[#e4e4e0] text-[#8a8a85]'}`}>
            {v}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-12 text-[13px] text-[#8a8a85]">Загрузка...</div>
      ) : scripts.length === 0 ? (
        <div className="text-center py-12 text-[13px] text-[#8a8a85]">
          Нет контента. Сгенерируйте первый в вкладке "Генератор".
        </div>
      ) : (
        <div className="space-y-3">
          {scripts.map(s => (
            <ScriptCard key={s.id} script={s} onUpdate={update} onDelete={del} />
          ))}
        </div>
      )}
    </div>
  )
}

function AnalyticsTab({ scripts }: { scripts: Script[] }) {
  const published = scripts.filter(s => s.status === 'published')
  const totalViews = published.reduce((a, s) => a + s.views_count, 0)
  const totalLeads = published.reduce((a, s) => a + s.leads_count, 0)
  const totalSaves = published.reduce((a, s) => a + s.saves_count, 0)
  const aiGenerated = scripts.filter(s => s.ai_generated).length

  const byType = Object.entries(CONTENT_TYPE_LABELS).map(([k, label]) => ({
    key: k, label,
    count: scripts.filter(s => s.content_type === k).length,
    views: scripts.filter(s => s.content_type === k).reduce((a, s) => a + s.views_count, 0),
  })).filter(x => x.count > 0)

  const topContent = [...published]
    .sort((a, b) => b.views_count - a.views_count)
    .slice(0, 5)

  return (
    <div className="space-y-5">
      {/* Summary stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Всего контента', value: scripts.length, sub: `${aiGenerated} AI-сгенерировано` },
          { label: 'Просмотры', value: totalViews.toLocaleString('ru'), sub: `${published.length} опубликовано` },
          { label: 'Лиды', value: totalLeads, sub: totalViews ? `${((totalLeads / totalViews) * 100).toFixed(1)}% конверсия` : '—' },
          { label: 'Сохранения', value: totalSaves, sub: 'органический охват' },
        ].map(stat => (
          <div key={stat.label} className="bg-white border border-[#e4e4e0] rounded-xl p-4">
            <p className="text-[11px] text-[#8a8a85] uppercase tracking-wider">{stat.label}</p>
            <p className="text-[24px] font-bold text-[#111110] mt-1">{stat.value}</p>
            <p className="text-[11px] text-[#8a8a85] mt-0.5">{stat.sub}</p>
          </div>
        ))}
      </div>

      {/* Pipeline */}
      <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
        <p className="text-[12px] font-semibold text-[#111110] mb-3">Пайплайн контента</p>
        <div className="flex gap-2">
          {STATUS_STEPS.map((s, i) => {
            const count = scripts.filter(sc => sc.status === s).length
            return (
              <div key={s} className="flex-1 text-center">
                <div className="flex items-center justify-center gap-1 mb-1">
                  {i > 0 && <span className="text-[#8a8a85]">›</span>}
                  <span className={`text-[11px] px-2 py-0.5 rounded-full ${STATUS_COLORS[s]}`}>{STATUS_LABELS[s]}</span>
                </div>
                <p className="text-[20px] font-bold text-[#111110]">{count}</p>
              </div>
            )
          })}
        </div>
      </div>

      {/* By type */}
      {byType.length > 0 && (
        <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
          <p className="text-[12px] font-semibold text-[#111110] mb-3">По форматам</p>
          <div className="space-y-2">
            {byType.sort((a, b) => b.views - a.views).map(t => (
              <div key={t.key} className="flex items-center gap-3 text-[12px]">
                <span className="w-32 text-[#6b6b66] truncate">{t.label}</span>
                <div className="flex-1 bg-[#f4f4f0] rounded-full h-2">
                  <div className="bg-blue-500 h-2 rounded-full"
                    style={{ width: `${totalViews ? (t.views / totalViews) * 100 : 0}%` }} />
                </div>
                <span className="w-20 text-right text-[#8a8a85]">{t.count} шт · {t.views.toLocaleString('ru')} 👁</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top performers */}
      {topContent.length > 0 && (
        <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
          <p className="text-[12px] font-semibold text-[#111110] mb-3">Топ по просмотрам</p>
          <div className="space-y-2">
            {topContent.map((s, i) => (
              <div key={s.id} className="flex items-center gap-3 text-[12px] py-1">
                <span className="w-5 text-[#8a8a85] font-mono">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[#111110] truncate">{s.title ?? '—'}</p>
                  <p className="text-[#8a8a85] text-[11px]">{CONTENT_TYPE_LABELS[s.content_type] ?? s.content_type}</p>
                </div>
                <div className="flex gap-4 text-[#6b6b66] flex-shrink-0">
                  <span>👁 {s.views_count.toLocaleString('ru')}</span>
                  <span>🎯 {s.leads_count}</span>
                  <span>🔖 {s.saves_count}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function VideoFactoryPage() {
  const [tab, setTab] = useState<'generator' | 'library' | 'analytics'>('generator')
  const [analyticsScripts, setAnalyticsScripts] = useState<Script[]>([])
  const [libraryKey, setLibraryKey] = useState(0)

  useEffect(() => {
    if (tab === 'analytics') {
      fetch('/api/marketing/scripts').then(r => r.json()).then(d => {
        setAnalyticsScripts(Array.isArray(d) ? d : [])
      })
    }
  }, [tab])

  function onSaved() {
    setLibraryKey(k => k + 1)
    if (tab === 'analytics') {
      fetch('/api/marketing/scripts').then(r => r.json()).then(d => {
        setAnalyticsScripts(Array.isArray(d) ? d : [])
      })
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">AI Video Factory</h1>
        <p className="text-[13px] text-[#6b6b66] mt-0.5">
          AI генерирует 12 элементов контента: хук, сценарий, структуру, диктора, кадры, B-roll, CTA, описание, обложку, монтаж, субтитры, B2B версию
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-[#f4f4f0] rounded-xl p-1">
        {([
          { key: 'generator', label: 'Генератор' },
          { key: 'library', label: 'Библиотека' },
          { key: 'analytics', label: 'Аналитика' },
        ] as const).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex-1 py-2 rounded-lg text-[13px] font-medium transition-colors ${
              tab === t.key ? 'bg-white text-[#111110] shadow-sm' : 'text-[#6b6b66] hover:text-[#111110]'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'generator' && <GeneratorTab onSaved={onSaved} />}
      {tab === 'library' && <LibraryTab key={libraryKey} />}
      {tab === 'analytics' && <AnalyticsTab scripts={analyticsScripts} />}
    </div>
  )
}
