import { NextRequest, NextResponse } from 'next/server'
import { requireMargin } from '@/lib/apiAuth'
import { createServiceClient } from '@/lib/supabase-service'
import { EDIT_FIELDS, refreshSaleFinance, type EditField } from '@/lib/sales/marginBook'

// Правки «Маржи» из приложения: расходы объекта и «закрыт» (решение владельца 05.10 —
// Вера дописывает пустые ячейки). Пишет сервер от имени вошедшего: журнал действий
// запишет автора. Книга «Маржа» не меняется — правка лежит поверх неё (margin_edits).

const isField = (f: unknown): f is EditField => typeof f === 'string' && (EDIT_FIELDS as string[]).includes(f)

export async function POST(req: NextRequest) {
  const guard = await requireMargin()
  if (guard instanceof NextResponse) return guard

  const body = await req.json().catch(() => null) as { saleId?: unknown; set?: Record<string, unknown>; clear?: unknown[] } | null
  const saleId = Number(body?.saleId)
  if (!Number.isInteger(saleId) || saleId <= 0) return NextResponse.json({ error: 'нет продажи' }, { status: 400 })
  const set = Object.entries(body?.set ?? {})
  const clear = body?.clear ?? []
  if (!set.length && !clear.length) return NextResponse.json({ error: 'нечего сохранять' }, { status: 400 })
  for (const [f, v] of set) {
    if (!isField(f)) return NextResponse.json({ error: `нет такой ячейки: ${f}` }, { status: 400 })
    const n = Number(v)
    if (typeof v !== 'number' || !Number.isFinite(n) || n < 0 || n >= 1e9) return NextResponse.json({ error: `${f}: сумма от 0 до миллиарда` }, { status: 400 })
    if (f === 'closed' && n !== 0 && n !== 1) return NextResponse.json({ error: 'closed: 0 или 1' }, { status: 400 })
  }
  if (!clear.every(isField)) return NextResponse.json({ error: 'нет такой ячейки' }, { status: 400 })

  const sb = createServiceClient({ actor: guard.userId })
  const { data: sale, error: saleErr } = await sb.from('crm_sales').select('id, department, voided').eq('id', saleId).maybeSingle()
  if (saleErr) return NextResponse.json({ error: saleErr.message }, { status: 500 })
  if (!sale || sale.voided || sale.department === 'b2b') return NextResponse.json({ error: 'продажи нет в «Продажах M-Glass»' }, { status: 404 })
  const { data: me } = await sb.from('users').select('name, email').eq('id', guard.userId).maybeSingle()
  const now = new Date().toISOString()

  const saved: string[] = []
  const cleared: string[] = []
  if (set.length) {
    const { data, error } = await sb.from('margin_edits').upsert(
      set.map(([field, value]) => ({ sale_id: saleId, field, value: Number(value), edited_by: guard.userId, edited_by_name: me?.name ?? me?.email ?? null, edited_at: now })),
      { onConflict: 'sale_id,field' },
    ).select('field')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    saved.push(...(data ?? []).map(r => r.field as string))
    if (saved.length !== set.length) return NextResponse.json({ error: `сохранилось ${saved.length} из ${set.length}` }, { status: 500 })
  }
  if (clear.length) {
    const { data, error } = await sb.from('margin_edits').delete().eq('sale_id', saleId).in('field', clear as string[]).select('field')
    if (error) return NextResponse.json({ error: error.message, saved }, { status: 500 })
    cleared.push(...(data ?? []).map(r => r.field as string))
  }

  // Себестоимость для CFO — сразу; сбой здесь правку не отменяет, утренняя сверка догонит.
  let financeError: string | null = null
  await refreshSaleFinance(sb, saleId).catch(e => { financeError = e instanceof Error ? e.message : String(e) })
  return NextResponse.json({ ok: true, saved, cleared, financeError })
}
