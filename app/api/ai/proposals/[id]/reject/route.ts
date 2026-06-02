// app/api/ai/proposals/[id]/reject/route.ts
//
// POST /api/ai/proposals/[id]/reject
//
// Transitions the proposal status from pending_approval → rejected.
// Records rejected_at, rejection_reason, approval_snapshot.
// The record is preserved — records are never deleted (permanent audit trail).
//
// Body (optional JSON):
//   { rejection_reason?: string }

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import type { AgentApprovalSnapshot } from '@/lib/ai-tools/agentActionLogTypes'

const ALLOWED_ROLES = new Set(['admin', 'manager'])

export async function POST(
  req: NextRequest,
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

  // ── Parse body (rejection_reason is optional) ─────────────────────────────
  let rejectionReason: string | null = null
  try {
    const body = await req.json()
    if (typeof body.rejection_reason === 'string' && body.rejection_reason.trim()) {
      rejectionReason = body.rejection_reason.trim()
    }
  } catch {
    // body is optional — no-op
  }

  const svc = createServiceClient()

  // ── Verify record exists and is rejectable ────────────────────────────────
  const { data: existing, error: fetchError } = await svc
    .from('agent_action_log')
    .select('id, status, proposal_title')
    .eq('id', id)
    .single()

  if (fetchError || !existing) {
    return NextResponse.json({ error: 'Запись не найдена' }, { status: 404 })
  }

  const existingRow = existing as { id: number; status: string; proposal_title: string | null }

  if (existingRow.status === 'rejected') {
    return NextResponse.json({ error: 'Черновик уже отклонён' }, { status: 409 })
  }
  if (existingRow.status === 'approved') {
    return NextResponse.json({ error: 'Черновик уже одобрен — отклонение невозможно' }, { status: 409 })
  }

  // ── Apply rejection ───────────────────────────────────────────────────────
  const now        = new Date().toISOString()
  const rejectedBy = user.email ?? user.id

  const approvalSnapshot: AgentApprovalSnapshot = {
    approved_by:    rejectedBy,
    timestamp:      now,
    action_taken:   'rejected',
    draft_title:    existingRow.proposal_title ?? undefined,
    manager_notes:  rejectionReason ?? undefined,
  }

  const { error: updateError } = await svc
    .from('agent_action_log')
    .update({
      status:            'rejected',
      rejected_at:       now,
      rejection_reason:  rejectionReason,
      approval_snapshot: approvalSnapshot,
    })
    .eq('id', id)

  if (updateError) {
    console.error('[POST /api/ai/proposals/[id]/reject] update error:', updateError)
    return NextResponse.json({ error: 'Не удалось сохранить решение' }, { status: 500 })
  }

  return NextResponse.json({
    ok:               true,
    id,
    status:           'rejected',
    rejected_at:      now,
    rejected_by:      rejectedBy,
    rejection_reason: rejectionReason,
  })
}
