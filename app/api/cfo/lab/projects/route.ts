import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { getSessionUser } from '@/lib/getRole'
import { listProjects, upsertProject } from '@/lib/lab/store'
import { projectErrors, type LabProject } from '@/lib/economics/lab/project'

export const dynamic = 'force-dynamic'

export async function GET() {
  const guard = await requireRole(['admin', 'ceo', 'cfo'])
  if (guard instanceof NextResponse) return guard
  const { rows, error } = await listProjects()
  if (error) return NextResponse.json({ error: `Проекты не прочитались: ${error}`, rows: [] }, { status: 200 })
  return NextResponse.json({ rows })
}

export async function POST(req: Request) {
  const guard = await requireRole(['admin', 'ceo', 'cfo'])
  if (guard instanceof NextResponse) return guard
  let body: { project?: LabProject }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Некорректный JSON' }, { status: 400 }) }
  if (!body.project) return NextResponse.json({ error: 'Нет проекта' }, { status: 400 })
  const errors = projectErrors(body.project)
  if (errors.length) return NextResponse.json({ error: errors.join('; ') }, { status: 400 })
  const user = await getSessionUser()
  const res = await upsertProject(body.project, user?.id ?? null)
  if ('error' in res) return NextResponse.json({ error: `Не сохранилось: ${res.error}` }, { status: 500 })
  return NextResponse.json(res)
}
