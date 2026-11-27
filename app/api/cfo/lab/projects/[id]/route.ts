import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { getSessionUser } from '@/lib/getRole'
import { deleteProject, getProject, listVariants, upsertProject } from '@/lib/lab/store'
import { projectErrors, type LabProject } from '@/lib/economics/lab/project'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireRole(['admin', 'ceo', 'cfo'])
  if (guard instanceof NextResponse) return guard
  const { id } = await ctx.params
  const project = await getProject(id)
  if (!project) return NextResponse.json({ error: 'Проект не найден' }, { status: 404 })
  return NextResponse.json({ project, variants: await listVariants(id) })
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireRole(['admin', 'ceo', 'cfo'])
  if (guard instanceof NextResponse) return guard
  const { id } = await ctx.params
  let body: { project?: LabProject }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Некорректный JSON' }, { status: 400 }) }
  if (!body.project) return NextResponse.json({ error: 'Нет проекта' }, { status: 400 })
  const errors = projectErrors(body.project)
  if (errors.length) return NextResponse.json({ error: errors.join('; ') }, { status: 400 })
  const user = await getSessionUser()
  const res = await upsertProject({ ...body.project, id }, user?.id ?? null)
  if ('error' in res) return NextResponse.json({ error: `Не сохранилось: ${res.error}` }, { status: 500 })
  return NextResponse.json(res)
}

// Удаление проекта лаборатории: он не заказ и ни на что не ссылается, но варианты уходят вместе
// с ним — поэтому подтверждение спрашивает экран, а не маршрут.
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireRole(['admin', 'ceo', 'cfo'])
  if (guard instanceof NextResponse) return guard
  const { id } = await ctx.params
  try { await deleteProject(id) } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }) }
  return NextResponse.json({ ok: true })
}
