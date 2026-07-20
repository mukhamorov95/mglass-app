import { NextRequest, NextResponse } from 'next/server'
import { vladDb, requireVlad } from '@/lib/vlad/vladClient'

// Спорт-чеклист: упражнения на день + серия (streak).
// День засчитан, если отмечены ВСЕ упражнения списка.

export async function GET(req: NextRequest) {
  const gate = await requireVlad(req)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const db = vladDb()
  if (!db) return NextResponse.json({ error: 'VLAD_SUPABASE_* не настроены' }, { status: 503 })

  const { data: st } = await db.from('vlad_settings').select('value').eq('key', 'sport_exercises').single()
  const exercises: string[] = Array.isArray(st?.value) ? st.value : []

  const today = new Date().toISOString().slice(0, 10)
  const since = new Date(Date.now() - 120 * 86400_000).toISOString().slice(0, 10)
  const { data: rows } = await db.from('vlad_sport').select('day,exercise,done').gte('day', since).order('day', { ascending: false })

  const byDay = new Map<string, Map<string, boolean>>()
  for (const r of rows ?? []) {
    if (!byDay.has(r.day)) byDay.set(r.day, new Map())
    byDay.get(r.day)!.set(r.exercise, r.done)
  }
  const dayComplete = (d: string) => exercises.length > 0 && exercises.every(e => byDay.get(d)?.get(e) === true)

  // серия: считаем назад от сегодня (сегодня незакрытый день серию не рвёт)
  let streak = 0
  for (let i = 0; i < 120; i++) {
    const d = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10)
    if (dayComplete(d)) streak++
    else if (i === 0) continue
    else break
  }

  const todayMap = byDay.get(today) ?? new Map()
  return NextResponse.json({
    exercises,
    today: exercises.map(e => ({ exercise: e, done: todayMap.get(e) === true })),
    streak,
    todayComplete: dayComplete(today),
  })
}

export async function POST(req: NextRequest) {
  const gate = await requireVlad(req)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const db = vladDb()
  if (!db) return NextResponse.json({ error: 'VLAD_SUPABASE_* не настроены' }, { status: 503 })
  const b = await req.json().catch(() => ({}))

  // правка списка упражнений
  if (Array.isArray(b.exercises)) {
    const list = b.exercises.map((e: unknown) => String(e).trim()).filter(Boolean).slice(0, 12)
    await db.from('vlad_settings').upsert({ key: 'sport_exercises', value: list })
    return NextResponse.json({ ok: true, exercises: list })
  }

  // отметка упражнения на сегодня
  const exercise = String(b.exercise ?? '').trim()
  if (!exercise) return NextResponse.json({ error: 'Нужно exercise или exercises' }, { status: 400 })
  const today = new Date().toISOString().slice(0, 10)
  const { error } = await db.from('vlad_sport').upsert({ day: today, exercise, done: b.done !== false }, { onConflict: 'day,exercise' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
