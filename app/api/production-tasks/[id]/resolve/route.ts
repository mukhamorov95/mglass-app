import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/getRole'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'

// Закрытие проблемы с доски /production-app/problems.
//
// История неизменяема: кто и когда поднял проблему — не трогаем, повторное
// закрытие не перезаписывает первого решившего. Задача возвращается в очередь
// ('queued'), потому что работа по этапу так и не сделана.

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const taskId = Number((await ctx.params).id)
  if (!taskId) return NextResponse.json({ error: 'Неверный id' }, { status: 400 })

  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const resolution = (body.resolution as string | null)?.trim() || null

  const sb = createServiceClient()
  const { data: task, error: tErr } = await sb.from('production_tasks')
    .select('id, status, problem_at, problem_resolved_at')
    .eq('id', taskId)
    .single()
  if (tErr || !task) return NextResponse.json({ error: 'Задача не найдена' }, { status: 404 })
  if (!task.problem_at) return NextResponse.json({ error: 'По задаче нет проблемы' }, { status: 409 })
  if (task.problem_resolved_at) return NextResponse.json({ ok: true, already: true })

  const supa = await createClient()
  const { data: prof } = await supa.from('users').select('name').eq('id', user.id).maybeSingle()
  const who = (prof as { name: string | null } | null)?.name ?? user.email ?? null

  const now = new Date().toISOString()
  const upd: Record<string, unknown> = {
    problem_resolved_at: now,
    problem_resolved_by_name: who,
    problem_resolution: resolution,
    updated_at: now,
  }
  // Этап могли закрыть в обход доски — тогда статус не откатываем
  if (task.status === 'problem') upd.status = 'queued'

  const { error: uErr } = await sb.from('production_tasks').update(upd).eq('id', taskId)
  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
