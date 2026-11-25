import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { requireRole } from '@/lib/apiAuth'
import { actorName } from '@/lib/production/executor'
import { CUT_MARK_ROLES } from '@/lib/production/cutDone'
import { applyCutDone, undoCutDone, type CutUndo } from '@/lib/production/cutDoneApply'
import type { CutPosition } from '@/lib/production/cutterPlan'

const MAX = 300
const int = (v: unknown) => Number.isInteger(v) && (v as number) >= 0

export async function POST(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
  const guard = await requireRole([...CUT_MARK_ROLES])
  if (guard instanceof NextResponse) return guard

  const body = await req.json().catch(() => ({})) as { positions?: CutPosition[]; undo?: CutUndo }
  const { data: prof } = await supabase.from('users').select('name').eq('id', user.id).maybeSingle()
  const actor = { id: user.id, name: actorName((prof as { name: string | null } | null)?.name, user.email), email: user.email }
  const svc = createServiceClient()

  if (body.undo) {
    const u = body.undo
    const tasks = Array.isArray(u.tasks) ? u.tasks.filter(t => int(t?.task_id)).slice(0, MAX) : []
    if (typeof u.at !== 'string' || Number.isNaN(Date.parse(u.at)) || !tasks.length) return NextResponse.json({ error: 'Нечего отменять' }, { status: 400 })
    const res = await undoCutDone(svc, { at: u.at, tasks, flagged: Array.isArray(u.flagged) ? u.flagged.filter(int) : [] }, actor)
    return NextResponse.json(res)
  }

  const positions = Array.isArray(body.positions)
    ? body.positions.filter(p => int(p?.order_id) && int(p?.item_index) && int(p?.layer)).slice(0, MAX) : []
  if (!positions.length) return NextResponse.json({ error: 'Нечего отмечать' }, { status: 400 })
  return NextResponse.json(await applyCutDone(svc, positions, actor))
}
