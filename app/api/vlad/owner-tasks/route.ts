import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'

// Очередь задач владельца из Telegram-бота. Доступ — только личный аккаунт владельца (как /vlad).
async function guardOwner() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  return user?.email === 'admin@mglass.ru' ? user : null
}

export async function GET() {
  if (!await guardOwner()) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const svc = createServiceClient()
  const { data, error } = await svc
    .from('owner_tasks')
    .select('id, title, details, category, priority, source, status, result_note, created_at, updated_at')
    .in('status', ['queued', 'in_progress', 'done', 'cancelled'])
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const { data: workers } = await svc.from('owner_task_workers')
    .select('worker_id, last_seen').order('last_seen', { ascending: false }).limit(5)
  const now = Date.now()
  const alive = (workers ?? []).filter(w => now - new Date(w.last_seen as string).getTime() < 5 * 60_000)
  return NextResponse.json({ tasks: data ?? [], worker: { alive: alive.length > 0, list: alive } })
}

export async function PATCH(req: Request) {
  if (!await guardOwner()) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const { id, action, note } = await req.json().catch(() => ({}))
  const status = action === 'take' ? 'in_progress'
    : action === 'done' ? 'done'
    : action === 'cancel' ? 'cancelled'
    : action === 'requeue' ? 'queued'
    : null
  if (!id || !status) return NextResponse.json({ error: 'bad request' }, { status: 400 })
  const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() }
  if (typeof note === 'string' && note.trim()) patch.result_note = note.trim()
  const { error } = await createServiceClient().from('owner_tasks').update(patch).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
