import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { createServiceClient } from '@/lib/supabase-service'
import { SHOWER_MODELS, TIER_CONFIGS, HARDWARE_COLORS } from '@/lib/showerCalculator'
import { resolveBudgetColorId, type HwColorRow } from '@/lib/pricing/showerInputs'

// Себестоимость комплекта фурнитуры бюджет-тарифа по каждой модели и цвету.
// Правит владелец/CFO (Вера — под их доступом): значения кладутся в
// shower_budget_manual_prices и используются И калькулятором, И AI-менеджером Иваном.

const BUDGET_TIER = TIER_CONFIGS.find(t => t.value === 'budget')!
const BUDGET_COLORS = HARDWARE_COLORS.filter(c => BUDGET_TIER.colors.includes(c.value))

export async function GET() {
  const guard = await requireRole(['admin', 'ceo', 'cfo', 'buyer'])
  if (guard instanceof NextResponse) return guard
  const sb = createServiceClient()

  const [{ data: sm }, { data: hc }, { data: bmp }] = await Promise.all([
    sb.from('shower_models').select('code,title,description,hardware_base,glass_count,dim_type,hardware_type,active').eq('active', true).order('sort_order'),
    sb.from('shower_hw_colors').select('id,name').eq('active', true).order('id'),
    sb.from('shower_budget_manual_prices').select('model_id,color_id,price'),
  ])

  const hwColors = (hc ?? []) as HwColorRow[]
  const models = (sm && sm.length ? sm.map(r => ({
    id: r.code, label: r.title, desc: r.description, hardwareBase: r.hardware_base,
  })) : SHOWER_MODELS.map(m => ({ id: m.id, label: m.label, desc: m.desc, hardwareBase: m.hardwareBase })))

  const colors = BUDGET_COLORS.map(c => ({
    value: c.value, label: c.label, multiplier: c.multiplier,
    colorId: resolveBudgetColorId(hwColors, c.value) ?? null,
  }))

  return NextResponse.json({
    models,
    colors,
    hwTierMultiplier: BUDGET_TIER.hwMultiplier,
    prices: (bmp ?? []) as { model_id: string; color_id: number; price: number }[],
  })
}

export async function POST(req: NextRequest) {
  const guard = await requireRole(['admin', 'ceo', 'cfo', 'buyer'])
  if (guard instanceof NextResponse) return guard
  const sb = createServiceClient()

  let body: { items?: { model_id: string; color_id: number; price: number }[] }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }) }
  const items = Array.isArray(body.items) ? body.items : []
  if (!items.length) return NextResponse.json({ ok: true, saved: 0 })

  const toUpsert = items.filter(i => i.model_id && i.color_id && Number(i.price) > 0)
    .map(i => ({ model_id: i.model_id, color_id: i.color_id, price: Math.round(Number(i.price)) }))
  // price=0/пусто → сброс на формулу: удаляем ручную строку
  const toDelete = items.filter(i => i.model_id && i.color_id && !(Number(i.price) > 0))

  if (toUpsert.length) {
    const { error } = await sb.from('shower_budget_manual_prices').upsert(toUpsert, { onConflict: 'model_id,color_id' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }
  for (const d of toDelete) {
    await sb.from('shower_budget_manual_prices').delete().eq('model_id', d.model_id).eq('color_id', d.color_id)
  }
  return NextResponse.json({ ok: true, saved: toUpsert.length, cleared: toDelete.length })
}
