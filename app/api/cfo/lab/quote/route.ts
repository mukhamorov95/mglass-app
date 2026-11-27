import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { computeQuote } from '@/lib/lab/compute'
import { projectErrors, type LabProject } from '@/lib/economics/lab/project'

// Расчёт экспериментального проекта. Ничего не сохраняет: ни заказа, ни цены, ни истории.
// Доступ — владелец, CEO и CFO: в ответе себестоимость и ставки ресурсов.
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const guard = await requireRole(['admin', 'ceo', 'cfo'])
  if (guard instanceof NextResponse) return guard

  let body: { project?: LabProject }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Некорректный JSON' }, { status: 400 }) }
  const project = body.project
  if (!project) return NextResponse.json({ error: 'Нет проекта' }, { status: 400 })

  const errors = projectErrors(project)
  if (errors.length) return NextResponse.json({ error: errors.join('; '), errors }, { status: 400 })

  const out = await computeQuote(project)
  return NextResponse.json({
    quote: out.quote, legacy: out.legacy, notes: out.notes,
    refs: { source: out.refs.source, problems: out.refs.problems },
  })
}
