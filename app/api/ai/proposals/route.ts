// app/api/ai/proposals/route.ts
//
// GET /api/ai/proposals
//
// Returns a paginated list of agent_action_log records.
// Heavy jsonb columns (input_snapshot, output_snapshot, draft_payload,
// safety_snapshot, approval_snapshot, error_snapshot) are excluded from
// the list — use GET /api/ai/proposals/[id] for the full record.
//
// Query params:
//   status  — filter by status (optional)
//   limit   — page size (default 50, max 100)

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'

const LIST_COLUMNS = [
  'id', 'created_at', 'updated_at',
  'agent_key', 'skill_key', 'workflow_key', 'action_type', 'status',
  'client_name', 'proposal_title',
  'approval_required', 'can_send_to_client',
  'approved_at', 'rejected_at', 'approved_by', 'rejection_reason',
  'warnings', 'errors', 'model_call_executed', 'model_name',
  'created_by',
].join(', ')

export async function GET(req: NextRequest) {
  // ── Auth — any authenticated role can read ────────────────────────────────
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  // ── Parse query params ────────────────────────────────────────────────────
  const { searchParams } = req.nextUrl
  const statusFilter = searchParams.get('status') ?? null
  const limitParam   = parseInt(searchParams.get('limit') ?? '50', 10)
  const limit        = Number.isFinite(limitParam) && limitParam > 0
    ? Math.min(limitParam, 100)
    : 50

  // ── Query via service role (ensures we can read regardless of RLS SELECT) ─
  try {
    const svc = createServiceClient()
    let query = svc
      .from('agent_action_log')
      .select(LIST_COLUMNS)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (statusFilter) {
      query = query.eq('status', statusFilter)
    }

    const { data, error } = await query
    if (error) {
      console.error('[GET /api/ai/proposals] query error:', error)
      return NextResponse.json({ error: 'Не удалось загрузить список' }, { status: 500 })
    }

    return NextResponse.json({
      ok:    true,
      total: data?.length ?? 0,
      items: data ?? [],
    })
  } catch (err) {
    console.error('[GET /api/ai/proposals] service client error:', err)
    return NextResponse.json({ error: 'Внутренняя ошибка' }, { status: 500 })
  }
}
