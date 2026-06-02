// app/api/ai/proposals/[id]/approve/route.ts
//
// POST /api/ai/proposals/[id]/approve
//
// Transitions the proposal status from pending_approval → approved.
// Records approved_at, approved_by, approval_snapshot.
//
// Safety: approval does NOT trigger any of the following automatically:
//   - sending КП to client
//   - writing to CRM / AmoCRM
//   - creating a production order
//   - invoking Anthropic/OpenAI
//
// Those actions require a separate explicit step by the manager.

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import type { AgentApprovalSnapshot } from '@/lib/ai-tools/agentActionLogTypes'

const ALLOWED_ROLES = new Set(['admin', 'manager'])

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const { data: userRow } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()
  if (!ALLOWED_ROLES.has((userRow as { role: string } | null)?.role ?? '')) {
    return NextResponse.json({ error: 'Доступ запрещён' }, { status: 403 })
  }

  // ── Validate id ───────────────────────────────────────────────────────────
  const { id: idStr } = await params
  const id = parseInt(idStr, 10)
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'Неверный id' }, { status: 400 })
  }

  const svc = createServiceClient()

  // ── Verify record exists and is approvable ────────────────────────────────
  const { data: existing, error: fetchError } = await svc
    .from('agent_action_log')
    .select('id, status, proposal_title')
    .eq('id', id)
    .single()

  if (fetchError || !existing) {
    return NextResponse.json({ error: 'Запись не найдена' }, { status: 404 })
  }

  const existingRow = existing as { id: number; status: string; proposal_title: string | null }

  if (existingRow.status === 'approved') {
    return NextResponse.json({ error: 'Черновик уже одобрен' }, { status: 409 })
  }
  if (existingRow.status === 'rejected') {
    return NextResponse.json({ error: 'Черновик был отклонён — одобрение невозможно' }, { status: 409 })
  }

  // ── Apply approval ────────────────────────────────────────────────────────
  const now       = new Date().toISOString()
  const approvedBy = user.email ?? user.id

  const approvalSnapshot: AgentApprovalSnapshot = {
    approved_by:  approvedBy,
    timestamp:    now,
    action_taken: 'approved',
    draft_title:  existingRow.proposal_title ?? undefined,
  }

  const { error: updateError } = await svc
    .from('agent_action_log')
    .update({
      status:            'approved',
      approved_at:       now,
      approved_by:       approvedBy,
      approval_snapshot: approvalSnapshot,
    })
    .eq('id', id)

  if (updateError) {
    console.error('[POST /api/ai/proposals/[id]/approve] update error:', updateError)
    return NextResponse.json({ error: 'Не удалось сохранить решение' }, { status: 500 })
  }

  return NextResponse.json({
    ok:          true,
    id,
    status:      'approved',
    approved_at: now,
    approved_by: approvedBy,
    // Safety — approval does not trigger any automated action
    can_send_to_client: false,
    can_write_crm:      false,
    can_create_order:   false,
  })
}
