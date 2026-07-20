import { NextRequest, NextResponse } from 'next/server'
import { vladDb, requireVlad } from '@/lib/vlad/vladClient'

// План на день: что горит (просрочено/сегодня), ближайшие сроки, свежее из
// входящего. Детеминированный отбор — без AI, чтобы утро не зависело от модели.

export async function GET(req: NextRequest) {
  const gate = await requireVlad(req)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const db = vladDb()
  if (!db) return NextResponse.json({ error: 'VLAD_SUPABASE_* не настроены' }, { status: 503 })

  const today = new Date().toISOString().slice(0, 10)
  const soon = new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10)

  const { data: all, error } = await db.from('vlad_tasks')
    .select('*')
    .in('status', ['inbox', 'active'])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const tasks = all ?? []
  const overdue = tasks.filter(t => t.due_date && t.due_date < today)
  const dueToday = tasks.filter(t => t.due_date === today)
  const dueSoon = tasks.filter(t => t.due_date && t.due_date > today && t.due_date <= soon)
    .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)))
  const inboxCount = tasks.filter(t => t.status === 'inbox').length

  return NextResponse.json({ overdue, dueToday, dueSoon, inboxCount, date: today })
}
