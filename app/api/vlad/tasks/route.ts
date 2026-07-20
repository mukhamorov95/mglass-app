import { NextRequest, NextResponse } from 'next/server'
import { vladDb, requireVlad } from '@/lib/vlad/vladClient'

// Задачи личного контура: список, подтверждение из «Входящего», правки, статусы.

export async function GET(req: NextRequest) {
  const gate = await requireVlad(req)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const db = vladDb()
  if (!db) return NextResponse.json({ error: 'VLAD_SUPABASE_* не настроены' }, { status: 503 })
  const status = req.nextUrl.searchParams.get('status')
  let q = db.from('vlad_tasks').select('*').order('due_date', { ascending: true, nullsFirst: false }).order('id', { ascending: false })
  if (status) q = q.in('status', status.split(','))
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ tasks: data ?? [] })
}

export async function PATCH(req: NextRequest) {
  const gate = await requireVlad(req)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const db = vladDb()
  if (!db) return NextResponse.json({ error: 'VLAD_SUPABASE_* не настроены' }, { status: 503 })
  const b = await req.json().catch(() => ({}))
  const id = Number(b.id)
  if (!id) return NextResponse.json({ error: 'Нужен id' }, { status: 400 })

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (b.status && ['inbox', 'active', 'done', 'dropped'].includes(b.status)) {
    patch.status = b.status
    patch.done_at = b.status === 'done' ? new Date().toISOString() : null
  }
  if (b.role !== undefined) patch.role = b.role
  if (b.kind !== undefined) patch.kind = b.kind
  if (b.title !== undefined) patch.title = String(b.title).slice(0, 200)
  if (b.details !== undefined) patch.details = b.details ? String(b.details) : null
  if (b.due_date !== undefined) patch.due_date = /^\d{4}-\d{2}-\d{2}$/.test(String(b.due_date ?? '')) ? b.due_date : null
  if (b.contact !== undefined) patch.contact = b.contact ? String(b.contact) : null
  if (b.steps !== undefined && Array.isArray(b.steps)) patch.steps = b.steps

  const { data, error } = await db.from('vlad_tasks').update(patch).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ task: data })
}

export async function POST(req: NextRequest) {
  // ручное создание задачи без надиктовки
  const gate = await requireVlad(req)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const db = vladDb()
  if (!db) return NextResponse.json({ error: 'VLAD_SUPABASE_* не настроены' }, { status: 503 })
  const b = await req.json().catch(() => ({}))
  const title = String(b.title ?? '').trim()
  if (!title) return NextResponse.json({ error: 'Нужен title' }, { status: 400 })
  const { data, error } = await db.from('vlad_tasks').insert({
    title: title.slice(0, 200),
    role: b.role ?? 'ceo', kind: b.kind ?? 'task',
    details: b.details ?? null,
    due_date: /^\d{4}-\d{2}-\d{2}$/.test(String(b.due_date ?? '')) ? b.due_date : null,
    contact: b.contact ?? null, steps: [], status: b.status === 'active' ? 'active' : 'inbox',
  }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ task: data })
}
