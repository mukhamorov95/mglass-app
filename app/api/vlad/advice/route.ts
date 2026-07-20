import { NextRequest, NextResponse } from 'next/server'
import { vladDb, requireVlad } from '@/lib/vlad/vladClient'

// Разборы советника: чтение и отметка «прочитано».
export async function GET(req: NextRequest) {
  const gate = await requireVlad(req)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const db = vladDb()
  if (!db) return NextResponse.json({ error: 'VLAD_SUPABASE_* не настроены' }, { status: 503 })
  const { data, error } = await db.from('vlad_advice')
    .select('id,slot,title,items,read,created_at')
    .order('created_at', { ascending: false }).limit(30)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ advice: data ?? [] })
}

export async function PATCH(req: NextRequest) {
  const gate = await requireVlad(req)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const db = vladDb()
  if (!db) return NextResponse.json({ error: 'VLAD_SUPABASE_* не настроены' }, { status: 503 })
  const b = await req.json().catch(() => ({}))
  const id = Number(b.id)
  if (!id) return NextResponse.json({ error: 'Нужен id' }, { status: 400 })
  const { error } = await db.from('vlad_advice').update({ read: b.read !== false }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
