import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { loadReferences } from '@/lib/lab/store'
import { referenceStamp } from '@/lib/economics/engine/reference'
import { STATUS_LABEL } from '@/lib/economics/values'

// Список нормативов для выбора правки внутри проекта. Значения отдаются только владельцу,
// CEO и CFO: в финансовом справочнике ставки, выведенные из окладов.
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const guard = await requireRole(['admin', 'ceo', 'cfo'])
  if (guard instanceof NextResponse) return guard
  const q = (new URL(req.url).searchParams.get('q') ?? '').toLowerCase().trim()
  const refs = await loadReferences()
  const rows = (['tech', 'finance'] as const).flatMap(id => {
    const ref = refs[id]
    if (!ref) return []
    return ref.params
      .filter(p => !q || p.key.toLowerCase().includes(q) || p.label.toLowerCase().includes(q))
      .slice(0, 400)
      .map(p => ({
        ref: id, key: p.key, group: p.group, label: p.label, unit: p.unit,
        lo: p.lo, hi: p.hi, status: p.status, statusLabel: STATUS_LABEL[p.status], source: p.source,
      }))
  })
  return NextResponse.json({
    rows,
    stamps: {
      tech: refs.tech ? referenceStamp(refs.tech) : null,
      finance: refs.finance ? referenceStamp(refs.finance) : null,
    },
    source: refs.source,
    problems: refs.problems,
  })
}
