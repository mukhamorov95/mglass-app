'use client'

// Б4: голосовые предложения бухгалтеров. Сверху — ДОСЛОВНАЯ расшифровка
// (правило владельца: не перефразировать), ниже — AI-разбор «вы хотите: 1,2,3»
// с кнопкой подтверждения. Владелец/CFO видят все записи, бухгалтер — свои
// (разграничение в RLS). Ничего не удаляется — отклонённые остаются.

import { useEffect, useState, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase-browser'

type Item = { text: string; kind: string; done?: boolean; task_id?: number }
type TaskState = { status: string; result_note: string | null }

const TASK_META: Record<string, { label: string; cls: string }> = {
  queued:      { label: 'у владельца', cls: 'bg-blue-100 text-blue-800' },
  in_progress: { label: 'в работе',    cls: 'bg-amber-100 text-amber-800' },
  done:        { label: 'сделано',     cls: 'bg-emerald-100 text-emerald-800' },
  cancelled:   { label: 'отклонено',   cls: 'bg-[#f0f0ec] text-[#6b6b66]' },
}
type Note = {
  id: number; unit: string; source: string; transcript: string | null
  items: Item[]; summary: string | null; status: string; error: string | null
  answered_at: string | null; answered_by: string | null
  created_by_name: string | null; created_at: string
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  new:       { label: 'ждёт подтверждения', cls: 'bg-amber-100 text-amber-800' },
  confirmed: { label: 'подтверждено',       cls: 'bg-emerald-100 text-emerald-800' },
  rejected:  { label: 'не то',              cls: 'bg-[#f0f0ec] text-[#6b6b66]' },
  failed:    { label: 'разбор не удался',   cls: 'bg-red-100 text-red-700' },
}

export function NotesTab({ unit }: { unit: 'ip' | 'ooo' }) {
  const sb = createClient()
  const [notes, setNotes] = useState<Note[]>([])
  const [tasks, setTasks] = useState<Record<number, TaskState>>({})
  const [state, setState] = useState<'idle' | 'rec' | 'busy'>('idle')
  const [err, setErr] = useState<string | null>(null)
  const [textMode, setTextMode] = useState(false)
  const [text, setText] = useState('')
  const recRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  const load = useCallback(async () => {
    const { data } = await sb.from('accounting_notes').select('*').order('id', { ascending: false }).limit(100)
    setNotes((data ?? []) as Note[])
    const r = await fetch('/api/accounting/notes/confirm')
    if (r.ok) setTasks((await r.json()).tasks ?? {})
  }, [sb])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [load])

  async function send(body: FormData) {
    setState('busy'); setErr(null)
    body.append('unit', unit)
    const r = await fetch('/api/accounting/notes', { method: 'POST', body })
    const d = await r.json().catch(() => ({}))
    setState('idle')
    if (!r.ok) setErr(d.error ?? 'Не получилось — попробуй ещё раз')
    setText(''); setTextMode(false)
    await load()
  }

  async function startRec() {
    setErr(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4'
      const rec = new MediaRecorder(stream, { mimeType: mime })
      chunksRef.current = []
      rec.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      rec.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(chunksRef.current, { type: mime })
        if (blob.size < 2000) { setState('idle'); return }
        const f = new FormData()
        f.append('audio', blob, mime.includes('mp4') ? 'note.mp4' : 'note.webm')
        await send(f)
      }
      rec.start(); recRef.current = rec; setState('rec')
    } catch {
      setErr('Нет доступа к микрофону — можно написать текстом')
      setTextMode(true)
    }
  }

  // Подтверждение отдаём серверу: он же заводит задачи владельцу и пингует в Telegram
  async function setStatus(n: Note, status: string) {
    await fetch('/api/accounting/notes/confirm', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note_id: n.id, status }),
    })
    await load()
  }

  async function toggleItem(n: Note, idx: number) {
    const items = n.items.map((it, i) => i === idx ? { ...it, done: !it.done } : it)
    await sb.from('accounting_notes').update({ items }).eq('id', n.id)
    await load()
  }

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-xl border border-[#e4e4e0] p-5 text-center">
        {!textMode && (
          <button onClick={state === 'rec' ? () => { recRef.current?.stop(); setState('busy') } : state === 'idle' ? startRec : undefined}
            disabled={state === 'busy'}
            className={`w-20 h-20 rounded-full text-[28px] text-white shadow-lg active:scale-95 transition-transform ${
              state === 'rec' ? 'bg-red-600 animate-pulse' : state === 'busy' ? 'bg-[#9a9a95]' : 'bg-[#111110]'}`}>
            {state === 'rec' ? '■' : state === 'busy' ? '…' : '🎙'}
          </button>
        )}
        {state === 'idle' && !textMode && (
          <p className="text-[12px] text-[#9a9a95] mt-2">
            Нажми и скажи, что предлагаешь или что мешает. Запишу дословно, разложу по пунктам,
            а после твоего «верно» отправлю владельцу — ответ придёт сюда же.{' '}
            <button onClick={() => setTextMode(true)} className="underline">Или текстом</button>
          </p>
        )}
        {state === 'rec' && <p className="text-[12px] text-red-600 mt-2 font-medium">Говори. Нажми ■ когда закончишь.</p>}
        {state === 'busy' && <p className="text-[12px] text-[#9a9a95] mt-2">Расшифровываю и раскладываю по пунктам…</p>}
        {textMode && (
          <div className="space-y-2">
            <textarea value={text} onChange={e => setText(e.target.value)} rows={3} placeholder="Напиши как есть — разложу по пунктам"
              className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[14px] outline-none focus:border-[#111110]" />
            <div className="flex gap-2 justify-center">
              <button onClick={() => setTextMode(false)} className="px-3 py-1.5 rounded-lg border border-[#e4e4e0] text-[12px] text-[#6b6b66]">Отмена</button>
              <button onClick={() => { const f = new FormData(); f.append('text', text.trim()); if (text.trim()) send(f) }}
                disabled={state === 'busy'} className="px-4 py-1.5 rounded-lg bg-[#111110] text-white text-[12px] font-medium disabled:opacity-50">
                {state === 'busy' ? 'Разбираю…' : 'Отправить'}
              </button>
            </div>
          </div>
        )}
        {err && <p className="text-[12px] text-red-600 mt-2">{err}</p>}
      </div>

      {notes.length === 0 && (
        <div className="bg-white rounded-xl border border-[#e4e4e0] p-8 text-center text-[13px] text-[#9a9a95]">
          Пока ничего не записано
        </div>
      )}

      {notes.map(n => {
        const st = STATUS_META[n.status] ?? STATUS_META.new
        return (
          <div key={n.id} className="bg-white rounded-xl border border-[#e4e4e0] overflow-hidden">
            <div className="px-4 pt-3 pb-2 flex items-center justify-between gap-2">
              <p className="text-[12px] text-[#9a9a95]">
                {n.created_by_name ?? '—'} · {n.created_at.slice(8, 10)}.{n.created_at.slice(5, 7)} {n.created_at.slice(11, 16)}
                {n.source === 'text' && ' · текстом'}
              </p>
              <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${st.cls}`}>{st.label}</span>
            </div>

            {n.transcript && (
              <div className="px-4 pb-3">
                <p className="text-[11px] uppercase tracking-widest text-[#9a9a95] mb-1">Как сказано</p>
                <p className="text-[14px] text-[#111110] whitespace-pre-wrap leading-relaxed">{n.transcript}</p>
              </div>
            )}
            {n.error && <p className="px-4 pb-3 text-[13px] text-red-600">{n.error}</p>}

            {n.items.length > 0 && (
              <div className="px-4 py-3 border-t border-[#f0f0ee] bg-[#fafaf8]">
                <p className="text-[11px] uppercase tracking-widest text-[#9a9a95] mb-1.5">Вы хотите</p>
                {n.summary && <p className="text-[13px] text-[#6b6b66] mb-2">{n.summary}</p>}
                <ol className="space-y-1.5">
                  {n.items.map((it, i) => (
                    <li key={i} className="flex items-start gap-2 text-[14px]">
                      <button onClick={() => toggleItem(n, i)}
                        className={`mt-[3px] w-4 h-4 rounded border flex-shrink-0 text-[10px] leading-[14px] ${
                          it.done ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-[#c9c9c4]'}`}>
                        {it.done ? '✓' : ''}
                      </button>
                      <span className={it.done ? 'text-[#9a9a95] line-through' : 'text-[#111110]'}>
                        {i + 1}. {it.text}
                        <span className="text-[#9a9a95] text-[12px]"> · {it.kind}</span>
                        {it.task_id && tasks[it.task_id] && (
                          <>
                            <span className={`ml-2 text-[11px] px-2 py-0.5 rounded-full font-medium ${
                              (TASK_META[tasks[it.task_id]!.status] ?? TASK_META.queued).cls}`}>
                              {(TASK_META[tasks[it.task_id]!.status] ?? TASK_META.queued).label}
                            </span>
                            {tasks[it.task_id]!.result_note && (
                              <span className="block text-[12px] text-[#6b6b66] mt-0.5">
                                Ответ: {tasks[it.task_id]!.result_note}
                              </span>
                            )}
                          </>
                        )}
                      </span>
                    </li>
                  ))}
                </ol>
                {n.status === 'new' && (
                  <div className="flex gap-2 mt-3">
                    <button onClick={() => setStatus(n, 'confirmed')} className="px-3 py-1.5 rounded-lg bg-[#111110] text-white text-[12px] font-medium">Да, всё верно — владельцу</button>
                    <button onClick={() => setStatus(n, 'rejected')} className="px-3 py-1.5 rounded-lg border border-[#e4e4e0] text-[12px] text-[#6b6b66]">Понял не так</button>
                  </div>
                )}
                {n.status !== 'new' && n.answered_by && (
                  <p className="text-[11px] text-[#9a9a95] mt-2">{st.label} · {n.answered_by}</p>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
