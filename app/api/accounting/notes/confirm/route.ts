import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { notifyAdmins } from '@/lib/telegram'

// Б6: подтверждённый пункт бухгалтера превращается в задачу владельца.
// Раньше канал обрывался на status='confirmed' — человек говорил в пустоту.
// Теперь каждый пункт уходит в owner_tasks (та же очередь, что у Telegram-бота)
// и пингует владельца, а его ответ (result_note) возвращается в карточку.
// Задачи пишем service-role: owner_tasks закрыты RLS для всех, кроме владельцев.

const FIN_ROLES = ['accountant', 'cfo', 'admin', 'ceo'] as const
type Item = { text: string; kind?: string; done?: boolean; task_id?: number }

const PRIORITY: Record<string, 'low' | 'normal' | 'high'> = {
  проблема: 'high', задача: 'normal', вопрос: 'normal', предложение: 'low',
}

export async function POST(req: NextRequest) {
  const guard = await requireRole([...FIN_ROLES])
  if (guard instanceof NextResponse) return guard

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  const { data: me } = await sb.from('users').select('name').eq('id', user?.id ?? '').maybeSingle()
  const myName = (me as { name?: string } | null)?.name ?? user?.email ?? 'бухгалтерия'

  const body = await req.json().catch(() => ({}))
  const noteId = Number(body.note_id)
  const status = body.status === 'rejected' ? 'rejected' : 'confirmed'
  if (!(noteId > 0)) return NextResponse.json({ error: 'Нет записи' }, { status: 400 })

  // RLS: бухгалтер видит только свои записи — читаем от его имени
  const { data: note } = await sb.from('accounting_notes').select('*').eq('id', noteId).maybeSingle()
  if (!note) return NextResponse.json({ error: 'Запись не найдена' }, { status: 404 })

  const svc = createServiceClient()
  const items = (note.items ?? []) as Item[]

  if (status === 'rejected') {
    await svc.from('accounting_notes')
      .update({ status, answered_at: new Date().toISOString(), answered_by: myName })
      .eq('id', noteId)
    return NextResponse.json({ ok: true })
  }

  const unitLabel = note.unit === 'ooo' ? 'ООО' : 'ИП'
  const next: Item[] = []
  for (const it of items) {
    if (it.task_id || !it.text?.trim()) { next.push(it); continue }
    const { data: task } = await svc.from('owner_tasks').insert({
      raw_text: (note.transcript ?? it.text).slice(0, 4000),
      title: it.text.trim().slice(0, 160),
      details: `Бухгалтерия ${unitLabel} · ${note.created_by_name ?? myName}`
        + (note.summary ? ` · ${note.summary}` : ''),
      category: 'finance',
      priority: PRIORITY[it.kind ?? ''] ?? 'normal',
      source: note.source === 'text' ? 'text' : 'voice',
    }).select('id').single()
    next.push({ ...it, task_id: task ? Number(task.id) : undefined })
  }

  await svc.from('accounting_notes').update({
    items: next, status, answered_at: new Date().toISOString(), answered_by: myName,
  }).eq('id', noteId)

  const fresh = next.filter(i => i.task_id).map((i, n) => `${n + 1}. ${i.text}`)
  if (fresh.length) {
    await notifyAdmins(
      `🧾 Бухгалтерия (${unitLabel}), ${note.created_by_name ?? myName}:\n\n`
      + fresh.join('\n')
      + `\n\nВ очереди задач — /tasks`,
    ).catch(() => {})
  }

  return NextResponse.json({ ok: true, items: next })
}

// Ответ владельца обратно бухгалтеру: статусы задач, рождённых из его записей.
export async function GET() {
  const guard = await requireRole([...FIN_ROLES])
  if (guard instanceof NextResponse) return guard

  const sb = await createClient()
  const { data: notes } = await sb.from('accounting_notes').select('items').limit(200)
  const ids = ((notes ?? []) as { items: Item[] }[])
    .flatMap(n => (n.items ?? []).map(i => i.task_id))
    .filter((v): v is number => typeof v === 'number')
  if (!ids.length) return NextResponse.json({ tasks: {} })

  const svc = createServiceClient()
  const { data: tasks } = await svc.from('owner_tasks')
    .select('id,status,result_note,updated_at').in('id', ids)
  const map: Record<number, { status: string; result_note: string | null }> = {}
  for (const t of tasks ?? []) {
    map[Number(t.id)] = { status: t.status as string, result_note: (t.result_note as string) ?? null }
  }
  return NextResponse.json({ tasks: map })
}
