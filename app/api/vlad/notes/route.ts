import { NextRequest, NextResponse } from 'next/server'
import { vladDb, requireVlad } from '@/lib/vlad/vladClient'
import { parseNote, resummarize } from '@/lib/vlad/parseNote'

export const maxDuration = 120

// Приём надиктовки: аудио (webm/mp4) или готовый текст.
// 1) аудио → bucket vlad-audio (исходник не теряем никогда)
// 2) расшифровка Whisper (паттерн /api/ai/kp-transcribe)
// 3) разбор Claude → элементы → vlad_tasks со status='inbox'
// Если task_id передан — это дополнение к существующей задаче: текст дописывается
// в details, выжимка пересобирается.

async function transcribe(audio: Blob, filename: string): Promise<string> {
  const form = new FormData()
  form.append('file', audio, filename)
  form.append('model', 'whisper-1')
  form.append('language', 'ru')
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form,
    signal: AbortSignal.timeout(90_000),
  })
  if (!res.ok) throw new Error(`whisper_${res.status}: ${(await res.text()).slice(0, 150)}`)
  const j = await res.json() as { text?: string }
  return (j.text ?? '').trim()
}

export async function POST(req: NextRequest) {
  const gate = await requireVlad(req)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const db = vladDb()
  if (!db) return NextResponse.json({ error: 'VLAD_SUPABASE_* не настроены' }, { status: 503 })

  const form = await req.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: 'Нужна multipart-форма' }, { status: 400 })
  const audio = form.get('audio') as File | null
  const textInput = String(form.get('text') ?? '').trim()
  const taskId = Number(form.get('task_id') ?? 0) || null
  if (!audio && !textInput) return NextResponse.json({ error: 'Нужно аудио или текст' }, { status: 400 })

  // 1) сохранить исходник
  let audioPath: string | null = null
  if (audio) {
    const ext = audio.type.includes('mp4') ? 'mp4' : 'webm'
    audioPath = `${new Date().toISOString().replace(/[:.]/g, '-')}.${ext}`
    const { error: upErr } = await db.storage.from('vlad-audio').upload(audioPath, audio, { contentType: audio.type || 'audio/webm' })
    if (upErr) audioPath = null // не блокируем поток из-за хранилища
  }

  const { data: note, error: nErr } = await db.from('vlad_notes')
    .insert({ audio_path: audioPath, source: audio ? 'voice' : 'text', task_id: taskId })
    .select().single()
  if (nErr) return NextResponse.json({ error: nErr.message }, { status: 500 })

  try {
    // 2) расшифровка
    const transcript = audio ? await transcribe(audio, audio.name || 'note.webm') : textInput
    if (!transcript) throw new Error('Пустая расшифровка')
    await db.from('vlad_notes').update({ transcript }).eq('id', note.id)

    const today = new Date().toISOString().slice(0, 10)

    // 3а) дополнение существующей задачи
    if (taskId) {
      const { data: task } = await db.from('vlad_tasks').select('id,title,details').eq('id', taskId).single()
      if (!task) throw new Error('Задача не найдена')
      const details = [task.details, transcript].filter(Boolean).join('\n\n— ')
      const title = await resummarize(task.title, details).catch(() => task.title)
      await db.from('vlad_tasks').update({ details, title, updated_at: new Date().toISOString() }).eq('id', taskId)
      await db.from('vlad_notes').update({ status: 'parsed' }).eq('id', note.id)
      return NextResponse.json({ ok: true, appended: taskId, transcript })
    }

    // 3б) новые элементы во «Входящее»
    const items = await parseNote(transcript, today)
    if (items.length > 0) {
      const rows = items.map(it => ({
        note_id: note.id, role: it.role, kind: it.kind, title: it.title,
        details: it.details, due_date: it.due_date, contact: it.contact,
        steps: it.steps.map(s => ({ text: s, done: false })), status: 'inbox',
      }))
      const { error: tErr } = await db.from('vlad_tasks').insert(rows)
      if (tErr) throw new Error(tErr.message)
    }
    await db.from('vlad_notes').update({ status: 'parsed' }).eq('id', note.id)
    return NextResponse.json({ ok: true, created: items.length, transcript })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Ошибка разбора'
    await db.from('vlad_notes').update({ status: 'error', error: msg }).eq('id', note.id)
    return NextResponse.json({ error: msg, note_id: note.id }, { status: 500 })
  }
}
