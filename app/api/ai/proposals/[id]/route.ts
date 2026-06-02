// app/api/ai/proposals/[id]/route.ts
//
// GET /api/ai/proposals/[id]
//
// Returns the full agent_action_log record including all jsonb payloads.
// 404 if not found. 400 if id is not a positive integer.

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // ── Auth — any authenticated role can read ────────────────────────────────
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  // ── Validate id ───────────────────────────────────────────────────────────
  const { id: idStr } = await params
  const id = parseInt(idStr, 10)
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'Неверный id' }, { status: 400 })
  }

  // ── Fetch full record ─────────────────────────────────────────────────────
  try {
    const svc = createServiceClient()
    const { data, error } = await svc
      .from('agent_action_log')
      .select('*')
      .eq('id', id)
      .single()

    if (error || !data) {
      return NextResponse.json({ error: 'Запись не найдена' }, { status: 404 })
    }

    return NextResponse.json({ ok: true, proposal: data })
  } catch (err) {
    console.error('[GET /api/ai/proposals/[id]] service client error:', err)
    return NextResponse.json({ error: 'Внутренняя ошибка' }, { status: 500 })
  }
}
