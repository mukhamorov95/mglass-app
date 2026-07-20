import { NextRequest, NextResponse } from 'next/server'
import { vladDb, requireVlad } from '@/lib/vlad/vladClient'

// CRUD финансовых обязательств владельца. Все данные — в отдельной базе
// vlad-personal; сюда ходим только с сервера. Гейт: владелец + ПИН-кука.

export async function GET(req: NextRequest) {
  const gate = await requireVlad(req)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const db = vladDb()
  if (!db) return NextResponse.json({ error: 'VLAD_SUPABASE_* не настроены' }, { status: 503 })
  const { data, error } = await db.from('vlad_obligations').select('*').order('closed_at', { nullsFirst: true }).order('principal', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ obligations: data ?? [] })
}

export async function POST(req: NextRequest) {
  const gate = await requireVlad(req)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const db = vladDb()
  if (!db) return NextResponse.json({ error: 'VLAD_SUPABASE_* не настроены' }, { status: 503 })
  const b = await req.json().catch(() => ({}))
  const creditor = String(b.creditor ?? '').trim()
  const principal = Number(b.principal)
  const monthly = Number(b.monthly_payment)
  if (!creditor || !(principal > 0) || !(monthly >= 0)) {
    return NextResponse.json({ error: 'Нужны: кому, остаток > 0, платёж ≥ 0' }, { status: 400 })
  }
  const { data, error } = await db.from('vlad_obligations').insert({
    creditor,
    kind: ['credit', 'card', 'loan_person', 'mortgage', 'tax', 'other'].includes(b.kind) ? b.kind : 'other',
    principal,
    rate_pct: Number(b.rate_pct) || 0,
    monthly_payment: monthly,
    due_day: b.due_day ? Math.min(31, Math.max(1, Number(b.due_day))) : null,
    note: b.note ? String(b.note) : null,
  }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ obligation: data })
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
  if (b.creditor !== undefined) patch.creditor = String(b.creditor).trim()
  if (b.principal !== undefined) patch.principal = Number(b.principal)
  if (b.rate_pct !== undefined) patch.rate_pct = Number(b.rate_pct) || 0
  if (b.monthly_payment !== undefined) patch.monthly_payment = Number(b.monthly_payment)
  if (b.due_day !== undefined) patch.due_day = b.due_day ? Math.min(31, Math.max(1, Number(b.due_day))) : null
  if (b.note !== undefined) patch.note = b.note ? String(b.note) : null
  if (b.kind !== undefined && ['credit', 'card', 'loan_person', 'mortgage', 'tax', 'other'].includes(b.kind)) patch.kind = b.kind
  // закрытие/переоткрытие — история побед, строки не удаляются
  if (b.closed === true) patch.closed_at = new Date().toISOString()
  if (b.closed === false) patch.closed_at = null
  const { data, error } = await db.from('vlad_obligations').update(patch).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ obligation: data })
}
