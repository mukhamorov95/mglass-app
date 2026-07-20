'use client'

import { useRef, useState } from 'react'

// Кнопка надиктовки: зажал → говоришь → отпустил/нажал стоп → аудио уходит
// на /api/vlad/notes (Whisper → Claude → задачи). Исходник сохраняется всегда.
// taskId — режим «дополнить задачу»: текст допишется в details.

type Props = { taskId?: number; onDone: (r: { created?: number; appended?: number; transcript?: string }) => void; compact?: boolean }

export default function VoiceButton({ taskId, onDone, compact }: Props) {
  const [state, setState] = useState<'idle' | 'rec' | 'busy'>('idle')
  const [err, setErr] = useState<string | null>(null)
  const [textMode, setTextMode] = useState(false)
  const [text, setText] = useState('')
  const recRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  async function start() {
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
        if (blob.size < 2000) { setState('idle'); return }  // случайное касание
        await upload(blob, mime)
      }
      rec.start()
      recRef.current = rec
      setState('rec')
    } catch {
      setErr('Нет доступа к микрофону — можно ввести текстом')
      setTextMode(true)
    }
  }

  function stop() {
    recRef.current?.stop()
    setState('busy')
  }

  async function upload(blob: Blob, mime: string) {
    setState('busy')
    const form = new FormData()
    form.append('audio', blob, mime.includes('mp4') ? 'note.mp4' : 'note.webm')
    if (taskId) form.append('task_id', String(taskId))
    const r = await fetch('/api/vlad/notes', { method: 'POST', body: form })
    const d = await r.json().catch(() => ({}))
    setState('idle')
    if (!r.ok) { setErr(d.error ?? 'Не разобралось — попробуй ещё раз'); return }
    onDone(d)
  }

  async function sendText() {
    if (!text.trim()) return
    setState('busy')
    const form = new FormData()
    form.append('text', text.trim())
    if (taskId) form.append('task_id', String(taskId))
    const r = await fetch('/api/vlad/notes', { method: 'POST', body: form })
    const d = await r.json().catch(() => ({}))
    setState('idle')
    if (!r.ok) { setErr(d.error ?? 'Ошибка'); return }
    setText(''); setTextMode(false)
    onDone(d)
  }

  return (
    <div className={compact ? '' : 'text-center'}>
      {!textMode && (
        <button
          onClick={state === 'rec' ? stop : state === 'idle' ? start : undefined}
          disabled={state === 'busy'}
          className={compact
            ? `px-3 py-1.5 rounded-lg text-[12px] font-medium ${state === 'rec' ? 'bg-red-600 text-white animate-pulse' : 'bg-[#f0f0ec] text-[#111110]'}`
            : `w-20 h-20 rounded-full text-[28px] shadow-lg transition-transform active:scale-95 ${
                state === 'rec' ? 'bg-red-600 animate-pulse' : state === 'busy' ? 'bg-[#9a9a95]' : 'bg-[#111110]'}`}>
          {state === 'rec' ? (compact ? '■ Стоп' : '■') : state === 'busy' ? (compact ? 'Разбираю…' : '…') : (compact ? '🎙 Надиктовать' : '🎙')}
        </button>
      )}
      {!compact && state === 'idle' && !textMode && (
        <p className="text-[12px] text-[#9a9a95] mt-2">
          Нажми и говори — задачи, мысли, сроки, вперемешку.{' '}
          <button onClick={() => setTextMode(true)} className="underline">Или текстом</button>
        </p>
      )}
      {!compact && state === 'rec' && <p className="text-[12px] text-red-600 mt-2 font-medium">Говори. Нажми ■ когда закончишь.</p>}
      {!compact && state === 'busy' && <p className="text-[12px] text-[#9a9a95] mt-2">Расшифровываю и раскладываю по ролям…</p>}
      {textMode && (
        <div className="mt-2 space-y-2">
          <textarea value={text} onChange={e => setText(e.target.value)} rows={3}
            placeholder="Напиши как думаешь — разложу по ролям"
            className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[14px] outline-none focus:border-[#111110]" />
          <div className="flex gap-2 justify-center">
            <button onClick={() => setTextMode(false)} className="px-3 py-1.5 rounded-lg border border-[#e4e4e0] text-[12px] text-[#6b6b66]">Отмена</button>
            <button onClick={sendText} disabled={state === 'busy'} className="px-4 py-1.5 rounded-lg bg-[#111110] text-white text-[12px] font-medium disabled:opacity-50">
              {state === 'busy' ? 'Разбираю…' : 'Отправить'}
            </button>
          </div>
        </div>
      )}
      {err && <p className="text-[12px] text-red-600 mt-2">{err}</p>}
    </div>
  )
}
