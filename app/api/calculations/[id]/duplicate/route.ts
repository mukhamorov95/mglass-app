import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { calcWriter, seesAllCalculations } from '@/lib/calcAccess'
import { buildDuplicate, CALC_LIST_COLS, DUPLICATE_SOURCE_COLS, type DuplicateSource } from '@/lib/calcDuplicate'

export const dynamic = 'force-dynamic'

// «Дублировать» в /calculations. INSERT-политики у calculations нет — расчёт пишет
// только сервер (как /api/calculations/save), поэтому копию вставляет service-role.
// До вставки две проверки: исходник читается под RLS вызывающего, и он свой либо
// вызывающий видит все расчёты — то же правило, по которому список его показал.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const a = await calcWriter()
  if ('error' in a) return a.error

  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Нужен id расчёта' }, { status: 400 })

  const supabase = await createClient()
  const { data: src, error: readErr } = await supabase.from('calculations')
    .select(DUPLICATE_SOURCE_COLS).eq('id', id).maybeSingle()
  if (readErr) return NextResponse.json({ error: `Не удалось прочитать расчёт: ${readErr.message}` }, { status: 500 })
  if (!src) return NextResponse.json({ error: 'Расчёт не найден или нет доступа к нему' }, { status: 404 })

  const source = src as unknown as DuplicateSource
  if (source.created_by !== a.userId) {
    let seesAll: boolean
    try {
      seesAll = await seesAllCalculations(supabase, a.userId, a.role)
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 })
    }
    if (!seesAll) return NextResponse.json({ error: 'Это чужой расчёт' }, { status: 403 })
  }

  const copy = buildDuplicate(source, a.userId)
  if (!copy.ok) return NextResponse.json({ error: copy.error }, { status: 422 })

  const { data, error } = await createServiceClient().from('calculations')
    .insert(copy.row).select(CALC_LIST_COLS).single()
  if (error) return NextResponse.json({ error: `DB: ${error.message}` }, { status: 500 })
  return NextResponse.json({ calc: data })
}
