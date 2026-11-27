import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { getSessionUser } from '@/lib/getRole'
import { computeQuote } from '@/lib/lab/compute'
import { deleteVariant, listVariants, saveVariant } from '@/lib/lab/store'
import { projectErrors, type LabProject } from '@/lib/economics/lab/project'

// Сохранённый вариант — снимок входа и результата. Правка справочника его не меняет: пересчёт
// делается явно и создаёт новый вариант (§16 ТЗ).
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const guard = await requireRole(['admin', 'ceo', 'cfo'])
  if (guard instanceof NextResponse) return guard
  const projectId = new URL(req.url).searchParams.get('projectId')
  if (!projectId) return NextResponse.json({ error: 'Нет проекта' }, { status: 400 })
  return NextResponse.json({ rows: await listVariants(projectId) })
}

export async function POST(req: Request) {
  const guard = await requireRole(['admin', 'ceo', 'cfo'])
  if (guard instanceof NextResponse) return guard
  let body: { projectId?: string; label?: string; note?: string; project?: LabProject }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Некорректный JSON' }, { status: 400 }) }
  if (!body.projectId || !body.project) return NextResponse.json({ error: 'Нужны проект и его id' }, { status: 400 })
  if (!body.label?.trim()) return NextResponse.json({ error: 'У варианта нужно название' }, { status: 400 })
  const errors = projectErrors(body.project)
  if (errors.length) return NextResponse.json({ error: errors.join('; ') }, { status: 400 })

  const out = await computeQuote(body.project)
  if (!out.quote) return NextResponse.json({ error: out.notes.join('; ') || 'Расчёт не выполнен' }, { status: 409 })
  const user = await getSessionUser()
  try {
    const id = await saveVariant(body.projectId, body.label.trim(), body.note ?? '', body.project, out.quote, user?.id ?? null)
    return NextResponse.json({ id, quote: out.quote })
  } catch (e) {
    return NextResponse.json({ error: `Вариант не сохранился: ${String(e)}` }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  const guard = await requireRole(['admin', 'ceo', 'cfo'])
  if (guard instanceof NextResponse) return guard
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Нет варианта' }, { status: 400 })
  try { await deleteVariant(id) } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }) }
  return NextResponse.json({ ok: true })
}
