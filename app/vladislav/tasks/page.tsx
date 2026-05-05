'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'

type TaskStatus = 'pending' | 'in_progress' | 'done' | 'failed'
type TaskType   = 'config' | 'code'

type Task = {
  id: string
  title: string
  voice_input: string | null
  prompt: string
  type: TaskType
  status: TaskStatus
  result: string | null
  created_at: string
  done_at: string | null
}

interface ISpeechRecognition extends EventTarget {
  lang: string; continuous: boolean; interimResults: boolean
  start(): void; stop(): void
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

const STATUS_MAP: Record<TaskStatus, { label: string; cls: string }> = {
  pending:     { label: '⏳ Ожидает',     cls: 'bg-slate-100 text-slate-600' },
  in_progress: { label: '⚙️ Выполняется', cls: 'bg-blue-100 text-blue-700' },
  done:        { label: '✅ Готово',       cls: 'bg-emerald-100 text-emerald-700' },
  failed:      { label: '❌ Ошибка',       cls: 'bg-red-100 text-red-600' },
}

const TYPE_MAP: Record<TaskType, { label: string; cls: string }> = {
  config: { label: 'Авто', cls: 'bg-violet-100 text-violet-700' },
  code:   { label: 'Код',  cls: 'bg-amber-100 text-amber-700' },
}

function fmt(d: string) {
  return new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function TasksPage() {
  const [tasks, setTasks]           = useState<Task[]>([])
  const [loading, setLoading]       = useState(true)
  const [voiceText, setVoiceText]   = useState('')
  const [interim, setInterim]       = useState('')
  const [recording, setRecording]   = useState(false)
  const [generating, setGenerating] = useState(false)
  const [newTask, setNewTask]       = useState<Task | null>(null)
  const [expanded, setExpanded]     = useState<string | null>(null)
  const [speechOk, setSpeechOk]     = useState(false)
  const [applying, setApplying]     = useState<string | null>(null)
  const recRef = useRef<ISpeechRecognition | null>(null)

  useEffect(() => {
    setSpeechOk(typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window))
    load()
  }, [])

  async function load() {
    const sb = createClient()
    const { data } = await sb.from('task_queue').select('*').order('created_at', { ascending: false }).limit(50)
    setTasks((data as Task[]) ?? [])
    setLoading(false)
  }

  function startRecording() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) return
    const rec = new SR()
    rec.lang = 'ru-RU'; rec.continuous = true; rec.interimResults = true
    rec.onresult = (e: any) => {
      let fin = '', tmp = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript
        if (e.results[i].isFinal) fin += t; else tmp += t
      }
      if (fin) setVoiceText(p => p + (p && !p.endsWith(' ') ? ' ' : '') + fin)
      setInterim(tmp)
    }
    rec.onerror = () => { setRecording(false); setInterim('') }
    rec.onend   = () => { setRecording(false); setInterim('') }
    recRef.current = rec
    rec.start()
    setRecording(true)
  }

  function stopRecording() { recRef.current?.stop(); setRecording(false); setInterim('') }
  function toggleRec() { recording ? stopRecording() : startRecording() }

  async function handleCreate() {
    const text = (voiceText + (interim ? ' ' + interim : '')).trim()
    if (!text) return
    stopRecording()
    setGenerating(true)
    setNewTask(null)
    try {
      const res = await fetch('/api/ai/generate-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voiceInput: text }),
      })
      const data = await res.json()
      setNewTask(data)
      setVoiceText('')
      await load()
      if (data.id) setExpanded(data.id)
    } finally {
      setGenerating(false)
    }
  }

  async function processNext() {
    await fetch('/api/cron/process-tasks', { method: 'POST' })
    await load()
  }

  async function applyTask(taskId: string) {
    setApplying(taskId)
    try {
      await fetch('/api/tasks/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId }),
      })
      await load()
    } finally {
      setApplying(null)
    }
  }

  const pending     = tasks.filter(t => t.status === 'pending').length
  const done        = tasks.filter(t => t.status === 'done').length
  const autoTasks   = tasks.filter(t => t.type === 'config' && t.status === 'pending').length

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-[22px] font-semibold text-[#1d1d1f]">Очередь задач</h1>
        {autoTasks > 0 && (
          <button onClick={processNext}
            className="px-3 py-1.5 rounded-xl bg-violet-600 text-white text-[12px] font-semibold hover:bg-violet-700 transition-colors">
            ▶ Выполнить авто ({autoTasks})
          </button>
        )}
      </div>
      <p className="text-[13px] text-[#6e6e73] mb-6">
        Надиктуйте идею — AI превратит её в задачу и поставит в очередь
      </p>

      {/* Stats row */}
      <div className="flex gap-3 mb-6">
        {[
          { label: 'Всего', value: tasks.length, cls: 'text-[#1d1d1f]' },
          { label: 'Ожидают', value: pending, cls: 'text-amber-600' },
          { label: 'Выполнено', value: done, cls: 'text-emerald-600' },
        ].map(c => (
          <div key={c.label} className="flex-1 bg-white rounded-2xl border border-[#e8e8ed] p-3 text-center">
            <p className={`text-[22px] font-bold ${c.cls}`}>{c.value}</p>
            <p className="text-[11px] text-[#aeaeb2]">{c.label}</p>
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="bg-white rounded-2xl border border-[#e8e8ed] p-5 mb-6">
        <p className="text-[12px] font-semibold text-[#6e6e73] uppercase tracking-wider mb-3">
          Новая идея
        </p>
        <div className="relative mb-4">
          <textarea
            value={voiceText + (interim || '')}
            onChange={e => setVoiceText(e.target.value)}
            placeholder={recording ? 'Говорите — текст появится здесь...' : 'Надиктуйте или напишите идею...'}
            rows={4}
            readOnly={recording}
            className="w-full resize-none bg-[#f9f9fb] border border-[#e8e8ed] rounded-xl px-4 py-3 text-[14px] text-[#1d1d1f] outline-none focus:border-[#0071e3] transition-colors placeholder:text-[#c7c7cc]"
          />
          {recording && (
            <div className="absolute top-3 right-3 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-[11px] text-red-500 font-medium">запись</span>
            </div>
          )}
        </div>
        <div className="flex gap-3">
          {speechOk && (
            <button onClick={toggleRec}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-medium transition-all ${
                recording ? 'bg-red-50 text-red-600 border border-red-200' : 'bg-[#f2f2f7] text-[#1d1d1f] hover:bg-[#e8e8ed]'
              }`}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2H3v2a9 9 0 0 0 8 8.94V23h2v-2.06A9 9 0 0 0 21 12v-2h-2z"/>
              </svg>
              {recording ? 'Стоп' : 'Микрофон'}
            </button>
          )}
          <button onClick={handleCreate}
            disabled={!(voiceText + interim).trim() || generating}
            className="flex-1 py-2 rounded-xl text-[13px] font-semibold bg-[#0071e3] text-white disabled:opacity-40 hover:bg-[#0077ed] transition-colors">
            {generating ? 'AI формирует задачу...' : 'Создать задачу'}
          </button>
        </div>
      </div>

      {/* Fresh task preview */}
      {newTask && (
        <div className="bg-[#f0f7ff] border border-[#cce0ff] rounded-2xl p-4 mb-5">
          <div className="flex items-center gap-2 mb-2">
            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${TYPE_MAP[newTask.type].cls}`}>
              {TYPE_MAP[newTask.type].label}
            </span>
            <p className="text-[14px] font-semibold text-[#1d1d1f]">{newTask.title}</p>
          </div>
          <p className="text-[12px] text-[#3a3a3c] leading-relaxed">{newTask.prompt}</p>
        </div>
      )}

      {/* Tasks list */}
      <div className="space-y-2">
        <p className="text-[12px] font-semibold text-[#aeaeb2] uppercase tracking-wider px-1">
          Все задачи
        </p>

        {loading ? (
          <p className="text-center text-[13px] text-[#aeaeb2] py-8">Загрузка...</p>
        ) : tasks.length === 0 ? (
          <p className="text-center text-[13px] text-[#aeaeb2] py-8">Задач пока нет — надиктуйте первую идею</p>
        ) : tasks.map(task => (
          <div key={task.id} className="bg-white rounded-2xl border border-[#e8e8ed] overflow-hidden">
            <button onClick={() => setExpanded(expanded === task.id ? null : task.id)}
              className="w-full px-4 py-3.5 flex items-center gap-3 text-left hover:bg-[#f9f9fb] transition-colors">
              {/* Status dot */}
              <div className={`w-2 h-2 rounded-full shrink-0 ${
                task.status === 'done' ? 'bg-emerald-500' :
                task.status === 'in_progress' ? 'bg-blue-500' :
                task.status === 'failed' ? 'bg-red-500' : 'bg-amber-400'
              }`} />

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className={`text-[13px] font-medium truncate ${task.status === 'done' ? 'text-[#6e6e73] line-through' : 'text-[#1d1d1f]'}`}>
                    {task.title}
                  </p>
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${TYPE_MAP[task.type].cls}`}>
                    {TYPE_MAP[task.type].label}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded-full ${STATUS_MAP[task.status].cls}`}>
                    {STATUS_MAP[task.status].label}
                  </span>
                  <span className="text-[11px] text-[#aeaeb2]">{fmt(task.created_at)}</span>
                  {task.done_at && <span className="text-[11px] text-emerald-600">✓ {fmt(task.done_at)}</span>}
                </div>
              </div>

              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#aeaeb2" strokeWidth="2" strokeLinecap="round"
                className={`shrink-0 transition-transform ${expanded === task.id ? 'rotate-180' : ''}`}>
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </button>

            {expanded === task.id && (
              <div className="px-4 pb-4 border-t border-[#f2f2f7] pt-3 space-y-3">
                {task.voice_input && (
                  <div>
                    <p className="text-[11px] font-semibold text-[#aeaeb2] uppercase tracking-wider mb-1">Исходная идея</p>
                    <p className="text-[13px] text-[#6e6e73] italic">"{task.voice_input}"</p>
                  </div>
                )}
                <div>
                  <p className="text-[11px] font-semibold text-[#aeaeb2] uppercase tracking-wider mb-1">Промт для исполнения</p>
                  <p className="text-[13px] text-[#1d1d1f] leading-relaxed whitespace-pre-wrap">{task.prompt}</p>
                </div>
                {task.result && (
                  <div className={`rounded-xl p-3 ${task.status === 'done' ? 'bg-emerald-50' : 'bg-red-50'}`}>
                    <p className="text-[11px] font-semibold text-[#aeaeb2] uppercase tracking-wider mb-1">Результат</p>
                    <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{task.result}</p>
                  </div>
                )}

                {/* Apply button */}
                {task.status !== 'done' && (
                  <button
                    onClick={() => applyTask(task.id)}
                    disabled={applying === task.id}
                    className={`w-full py-2 rounded-xl text-[13px] font-semibold transition-colors ${
                      task.type === 'config'
                        ? 'bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50'
                        : 'bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50'
                    }`}>
                    {applying === task.id ? 'Выполняется...' :
                      task.type === 'config' ? '⚡ Внедрить сейчас (авто)' : '📋 Поставить в очередь для разработчика'}
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
