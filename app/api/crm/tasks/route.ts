import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { getSessionUser } from '@/lib/getRole'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'

// Задачи/напоминания по лидам CRM (в духе amoCRM). Менеджер видит свои,
// владелец/CEO/РОП — все. GET (список: свои открытые или по лиду), POST (создать),
// PATCH (закрыть/вернуть). Каждое действие пишет событие в ленту лида.

const KINDS = ['call', 'meeting', 'measure', 'followup', 'other']

async function whoAmI(): Promise<{ name: string; canAll: boolean } | null> {
  const user = await getSessionUser()
  if (!user) return null
  const sb = await createClient()
  const { data } = await sb.from('users').select('name,role,can_view_all_deals').eq('id', user.id).maybeSingle()
  const p = data as { name: string | null; role: string | null; can_view_all_deals: boolean | null } | null
  const name = p?.name ?? user.email ?? ''
  const canAll = ['admin', 'ceo', 'commercial'].includes(p?.role ?? '') || !!p?.can_view_all_deals
  return { name, canAll }
}

export async function GET(req: NextRequest) {
  const guard = await requireRole(['admin', 'ceo', 'commercial', 'manager'])
  if (guard instanceof NextResponse) return guard
  const me = await whoAmI()
  if (!me) return NextResponse.json({ error: 'no user' }, { status: 401 })

  const leadId = Number(new URL(req.url).searchParams.get('lead_id')) || null
  const sb = createServiceClient()

  let query = sb.from('crm_tasks')
    .select('id,lead_id,title,kind,due_at,done,done_at,assignee,created_by,created_at, crm_leads(name,phone,manager,stage,status)')
    .order('due_at', { ascending: true })
    .limit(500)
  if (leadId) query = query.eq('lead_id', leadId)
  else query = query.eq('done', false)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  let rows = (data ?? []) as unknown as { assignee: string | null; crm_leads?: { manager: string | null } | null }[]
  // Изоляция: менеджер без «видит все» — только свои задачи (по исполнителю или менеджеру лида).
  if (!me.canAll && !leadId) rows = rows.filter(r => r.assignee === me.name || r.crm_leads?.manager === me.name)
  return NextResponse.json({ tasks: rows, me: me.name, canAll: me.canAll })
}

export async function POST(req: NextRequest) {
  const guard = await requireRole(['admin', 'ceo', 'commercial', 'manager'])
  if (guard instanceof NextResponse) return guard
  const me = await whoAmI()
  if (!me) return NextResponse.json({ error: 'no user' }, { status: 401 })

  let body: { lead_id?: number; title?: string; kind?: string; due_at?: string; assignee?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }) }
  const leadId = Number(body.lead_id)
  const title = (body.title ?? '').trim()
  const dueAt = (body.due_at ?? '').trim()
  if (!leadId || !title || !dueAt) return NextResponse.json({ error: 'lead_id, title, due_at обязательны' }, { status: 400 })
  const kind = KINDS.includes(body.kind ?? '') ? body.kind : 'followup'

  const sb = createServiceClient()
  const { data, error } = await sb.from('crm_tasks').insert({
    lead_id: leadId, title, kind, due_at: dueAt,
    assignee: (body.assignee ?? '').trim() || me.name, created_by: me.name,
  }).select('id').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await sb.from('crm_lead_events').insert({ lead_id: leadId, kind: 'system', text: `🗓 Задача: ${title}`, author: me.name })
  return NextResponse.json({ ok: true, id: (data as { id: number }).id })
}

export async function PATCH(req: NextRequest) {
  const guard = await requireRole(['admin', 'ceo', 'commercial', 'manager'])
  if (guard instanceof NextResponse) return guard
  const me = await whoAmI()
  if (!me) return NextResponse.json({ error: 'no user' }, { status: 401 })

  let body: { id?: number; done?: boolean }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }) }
  const id = Number(body.id)
  if (!id) return NextResponse.json({ error: 'id обязателен' }, { status: 400 })
  const done = body.done !== false

  const sb = createServiceClient()
  const { data, error } = await sb.from('crm_tasks')
    .update({ done, done_at: done ? new Date().toISOString() : null })
    .eq('id', id).select('lead_id,title').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const t = data as { lead_id: number; title: string }
  if (done) await sb.from('crm_lead_events').insert({ lead_id: t.lead_id, kind: 'system', text: `✅ Задача выполнена: ${t.title}`, author: me.name })
  return NextResponse.json({ ok: true })
}
