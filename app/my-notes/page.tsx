'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase-browser'

type Note = {
  id: string
  content: string
  ai_summary: string | null
  ai_insights: string[] | null
  ai_actions: string[] | null
  ai_for_bot: string | null
  created_at: string
}

type Analysis = {
  summary: string
  insights: string[]
  actions: string[]
  for_bot: string
  id?: string
}

function fmt(d: string) {
  return new Date(d).toLocaleDateString('ru-RU', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

// Extend Window with SpeechRecognition types
interface ISpeechRecognition extends EventTarget {
  lang: string
  continuous: boolean
  interimResults: boolean
  start(): void
  stop(): void
  onresult: ((e: any) => void) | null
  onerror: ((e: any) => void) | null
  onend: (() => void) | null
}

declare global {
  interface Window {
    SpeechRecognition: new () => ISpeechRecognition
    webkitSpeechRecognition: new () => ISpeechRecognition
  }
}

export default function MyNotesPage() {
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [text, setText] = useState('')
  const [recording, setRecording] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [interimText, setInterimText] = useState('')
  const [speechSupported, setSpeechSupported] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const recognitionRef = useRef<ISpeechRecognition | null>(null)
  const textRef = useRef(text)
  textRef.current = text

  useEffect(() => {
    setSpeechSupported(
      typeof window !== 'undefined' &&
      ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)
    )
    loadNotes().catch(() => setLoading(false))
  }, [])

  async function loadNotes() {
    const sb = createClient()
    const { data } = await sb
      .from('manager_notes')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50)
    setNotes((data as Note[]) ?? [])
    setLoading(false)
  }

  const stopRecording = useCallback(() => {
    recognitionRef.current?.stop()
    setRecording(false)
    setInterimText('')
  }, [])

  function startRecording() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) return

    const rec = new SR()
    rec.lang = 'ru-RU'
    rec.continuous = true
    rec.interimResults = true

    rec.onresult = (e: any) => {
      let interim = ''
      let finalChunk = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript
        if (e.results[i].isFinal) finalChunk += t
        else interim += t
      }
      if (finalChunk) {
        setText(prev => {
          const spacer = prev && !prev.endsWith(' ') && !prev.endsWith('\n') ? ' ' : ''
          return prev + spacer + finalChunk
        })
      }
      setInterimText(interim)
    }

    rec.onerror = () => { setRecording(false); setInterimText('') }
    rec.onend   = () => { setRecording(false); setInterimText('') }

    recognitionRef.current = rec
    rec.start()
    setRecording(true)
    setAnalysis(null)
  }

  function toggleRecording() {
    if (recording) stopRecording()
    else startRecording()
  }

  async function handleSubmit() {
    const content = (text + (interimText ? ' ' + interimText : '')).trim()
    if (!content) return
    if (recording) stopRecording()
    setAnalyzing(true)
    setAnalysis(null)

    try {
      const res = await fetch('/api/ai/analyze-note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      const data: Analysis = await res.json()
      setAnalysis(data)
      setText('')
      await loadNotes()
      if (data.id) setExpanded(data.id)
    } finally {
      setAnalyzing(false)
    }
  }

  const canSubmit = (text + interimText).trim().length > 5

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-[22px] font-semibold text-[#1d1d1f] mb-1">Мои заметки</h1>
      <p className="text-[13px] text-[#6e6e73] mb-6">
        Надиктуй или напиши наблюдение — AI разберёт и даст рекомендацию
      </p>

      {/* Input area */}
      <div className="bg-white rounded-2xl border border-[#e8e8ed] p-5 mb-6">
        <div className="relative">
          <textarea
            value={text + (interimText ? interimText : '')}
            onChange={e => {
              // Only update the stable text, not interim
              setText(e.target.value.slice(0, text.length + (e.target.value.length - text.length)))
              setText(e.target.value)
            }}
            placeholder={
              recording
                ? 'Говорите — текст появится здесь...'
                : 'Напишите заметку или нажмите микрофон чтобы надиктовать...'
            }
            rows={5}
            className="w-full resize-none bg-[#f9f9fb] border border-[#e8e8ed] rounded-xl px-4 py-3 text-[14px] text-[#1d1d1f] outline-none focus:border-[#0071e3] transition-colors placeholder:text-[#c7c7cc]"
            readOnly={recording}
          />
          {recording && (
            <div className="absolute top-3 right-3 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-[11px] text-red-500 font-medium">запись</span>
            </div>
          )}
        </div>

        {/* interim hint */}
        {interimText && (
          <p className="mt-1 text-[12px] text-[#aeaeb2] italic px-1">{interimText}</p>
        )}

        <div className="flex items-center gap-3 mt-4">
          {/* Mic button */}
          {speechSupported && (
            <button
              onClick={toggleRecording}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-medium transition-all ${
                recording
                  ? 'bg-red-50 text-red-600 border border-red-200'
                  : 'bg-[#f2f2f7] text-[#1d1d1f] hover:bg-[#e8e8ed]'
              }`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2H3v2a9 9 0 0 0 8 8.94V23h2v-2.06A9 9 0 0 0 21 12v-2h-2z"/>
              </svg>
              {recording ? 'Остановить' : 'Микрофон'}
            </button>
          )}

          <button
            onClick={handleSubmit}
            disabled={!canSubmit || analyzing}
            className="flex-1 py-2 rounded-xl text-[13px] font-semibold bg-[#0071e3] text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#0077ed] transition-colors"
          >
            {analyzing ? 'Анализирую...' : 'Проанализировать и сохранить'}
          </button>
        </div>

        {!speechSupported && (
          <p className="mt-3 text-[12px] text-[#aeaeb2]">
            Голосовой ввод доступен в Chrome и Safari
          </p>
        )}
      </div>

      {/* Fresh analysis result */}
      {analysis && (
        <div className="bg-[#f0f7ff] border border-[#cce0ff] rounded-2xl p-5 mb-6 animate-in fade-in">
          <p className="text-[12px] font-semibold text-[#0071e3] uppercase tracking-wider mb-3">
            AI разбор
          </p>
          <p className="text-[14px] text-[#1d1d1f] font-medium mb-4">{analysis.summary}</p>

          {analysis.insights?.length > 0 && (
            <div className="mb-4">
              <p className="text-[11px] font-semibold text-[#6e6e73] uppercase tracking-wider mb-2">Выводы</p>
              <ul className="space-y-1">
                {analysis.insights.map((s, i) => (
                  <li key={i} className="flex gap-2 text-[13px] text-[#1d1d1f]">
                    <span className="text-[#0071e3] shrink-0">•</span>{s}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {analysis.actions?.length > 0 && (
            <div className="mb-4">
              <p className="text-[11px] font-semibold text-[#6e6e73] uppercase tracking-wider mb-2">Действия</p>
              <ul className="space-y-1">
                {analysis.actions.map((a, i) => (
                  <li key={i} className="flex gap-2 text-[13px] text-[#1d1d1f]">
                    <span className="text-emerald-500 shrink-0">→</span>{a}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {analysis.for_bot && (
            <div className="bg-white rounded-xl p-3 border border-[#cce0ff]">
              <p className="text-[11px] font-semibold text-[#6e6e73] uppercase tracking-wider mb-1">
                Для AI-менеджера
              </p>
              <p className="text-[13px] text-[#1d1d1f]">{analysis.for_bot}</p>
            </div>
          )}
        </div>
      )}

      {/* Notes history */}
      <div className="space-y-3">
        <p className="text-[13px] font-semibold text-[#6e6e73] uppercase tracking-wider px-1">
          История заметок
        </p>

        {loading ? (
          <p className="text-center text-[13px] text-[#aeaeb2] py-8">Загрузка...</p>
        ) : notes.length === 0 ? (
          <p className="text-center text-[13px] text-[#aeaeb2] py-8">Заметок пока нет</p>
        ) : notes.map(note => (
          <div key={note.id} className="bg-white rounded-2xl border border-[#e8e8ed] overflow-hidden">
            <button
              onClick={() => setExpanded(expanded === note.id ? null : note.id)}
              className="w-full px-5 py-4 flex items-start gap-3 text-left hover:bg-[#f9f9fb] transition-colors"
            >
              <div className="flex-1 min-w-0">
                <p className="text-[13px] text-[#1d1d1f] line-clamp-2">
                  {note.ai_summary || note.content.slice(0, 120)}
                </p>
                <p className="text-[11px] text-[#aeaeb2] mt-1">{fmt(note.created_at)}</p>
              </div>
              <svg
                width="16" height="16" viewBox="0 0 24 24" fill="none"
                stroke="#aeaeb2" strokeWidth="2" strokeLinecap="round"
                className={`shrink-0 mt-1 transition-transform ${expanded === note.id ? 'rotate-180' : ''}`}
              >
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </button>

            {expanded === note.id && (
              <div className="px-5 pb-5 border-t border-[#f2f2f7] pt-4 space-y-4">
                {/* Original text */}
                <div>
                  <p className="text-[11px] font-semibold text-[#aeaeb2] uppercase tracking-wider mb-2">
                    Заметка
                  </p>
                  <p className="text-[13px] text-[#3a3a3c] whitespace-pre-wrap leading-relaxed">
                    {note.content}
                  </p>
                </div>

                {note.ai_insights && (note.ai_insights as string[]).length > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold text-[#aeaeb2] uppercase tracking-wider mb-2">
                      Выводы
                    </p>
                    <ul className="space-y-1">
                      {(note.ai_insights as string[]).map((s, i) => (
                        <li key={i} className="flex gap-2 text-[13px] text-[#1d1d1f]">
                          <span className="text-[#0071e3] shrink-0">•</span>{s}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {note.ai_actions && (note.ai_actions as string[]).length > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold text-[#aeaeb2] uppercase tracking-wider mb-2">
                      Действия
                    </p>
                    <ul className="space-y-1">
                      {(note.ai_actions as string[]).map((a, i) => (
                        <li key={i} className="flex gap-2 text-[13px] text-[#1d1d1f]">
                          <span className="text-emerald-500 shrink-0">→</span>{a}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {note.ai_for_bot && (
                  <div className="bg-[#f0f7ff] rounded-xl p-3">
                    <p className="text-[11px] font-semibold text-[#0071e3] uppercase tracking-wider mb-1">
                      Для AI-менеджера
                    </p>
                    <p className="text-[13px] text-[#1d1d1f]">{note.ai_for_bot}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
