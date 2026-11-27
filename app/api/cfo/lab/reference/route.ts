import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { getSessionUser } from '@/lib/getRole'
import { listReferenceHistory, loadReferences, saveReference } from '@/lib/lab/store'
import { referenceStamp, reviseReference, type Param } from '@/lib/economics/engine/reference'
import { toEdits, type Incoming } from '@/lib/economics/lab/refEdits'
import { STATUS_LABEL } from '@/lib/economics/values'

// Список нормативов для выбора правки внутри проекта и правка самого справочника. Значения
// отдаются только владельцу, CEO и CFO: в финансовом справочнике ставки, выведенные из окладов.
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const guard = await requireRole(['admin', 'ceo', 'cfo'])
  if (guard instanceof NextResponse) return guard
  const url = new URL(req.url)
  const history = url.searchParams.get('history')
  if (history === 'tech' || history === 'finance') {
    const { rows, error } = await listReferenceHistory(history)
    return NextResponse.json({ rows, error })
  }
  const q = (url.searchParams.get('q') ?? '').toLowerCase().trim()
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

// Правка норматива создаёт НОВУЮ версию справочника: прежняя уходит в историю целиком, в новой
// записано, что было, что стало и почему. Сохранённые варианты расчётов не пересчитываются —
// у них свой снимок и свой отпечаток (§16 ТЗ).
export async function PUT(req: Request) {
  const guard = await requireRole(['admin', 'ceo', 'cfo'])
  if (guard instanceof NextResponse) return guard
  let body: { ref?: string; reason?: string; edits?: Record<string, Incoming>; additions?: Param[] }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Некорректный JSON' }, { status: 400 }) }

  const id = body.ref === 'tech' || body.ref === 'finance' ? body.ref : null
  if (!id) return NextResponse.json({ error: 'Не указан справочник: tech или finance' }, { status: 400 })
  const reason = (body.reason ?? '').trim()
  if (!reason) return NextResponse.json({ error: 'Нужна причина изменения: без неё правку нельзя будет объяснить' }, { status: 400 })

  const refs = await loadReferences()
  const ref = refs[id]
  if (!ref) return NextResponse.json({ error: `Справочник не загружен: ${refs.problems.join('; ') || 'нет данных'}` }, { status: 409 })
  if (!refs.source[id]?.startsWith('база')) {
    return NextResponse.json({ error: `Правка пишется только в базу, а справочник сейчас читается из ${refs.source[id]}` }, { status: 409 })
  }

  const { edits, error } = toEdits(ref, body.edits ?? {})
  if (error) return NextResponse.json({ error }, { status: 400 })
  if (!edits.length && !(body.additions ?? []).length) {
    return NextResponse.json({ error: 'Изменений нет: значения совпадают с тем, что уже в справочнике' }, { status: 400 })
  }

  const user = await getSessionUser()
  const author = user?.email ?? 'кабинет'
  let next
  try {
    next = reviseReference(ref, edits, { reason, author, date: new Date().toISOString().slice(0, 10) }, body.additions ?? [])
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 400 })
  }
  try {
    await saveReference(id, next, reason, user?.id ?? null)
  } catch (e) {
    return NextResponse.json({ error: `Не сохранилось: ${String(e instanceof Error ? e.message : e)}` }, { status: 500 })
  }
  return NextResponse.json({
    ref: id, version: next.version, stamp: referenceStamp(next),
    changed: next.changes.length, changes: next.changes,
  })
}
