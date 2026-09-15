import { NextRequest, NextResponse } from 'next/server'
import { requireInventoryRead, requireInventoryWrite } from '@/lib/inventory/auth'
import { createServiceClient } from '@/lib/supabase-service'
import { isSheetMaterial } from '@/lib/materialUsage'
import { checkRemnants, type RemnantDraft } from '@/lib/production/remnants'

export const runtime = 'nodejs'

// Остатки листа (Э6.3). Таблицы закрыты RLS без политик — читаем и пишем только здесь,
// сервисным клиентом ПОСЛЕ проверки роли (lib/inventory/auth: смотрят склад — все, кто видит
// склад; пишут — владелец, снабжение, производство).

type MaterialRow = { id: number; name: string; thickness: number; sheet_width: number | null; sheet_height: number | null; category: string | null; pattern_direction: string | null; passthrough: boolean | null }

export async function GET(req: NextRequest) {
  const actor = await requireInventoryRead()
  if (actor instanceof NextResponse) return actor
  const svc = createServiceClient()
  const all = req.nextUrl.searchParams.get('all') === '1'

  let q = svc.from('sheet_remnants')
    .select('id, code, material_id, material_name, thickness, width_mm, height_mm, location, status, note, created_by_name, created_at, closed_by_name, closed_at')
    .order('created_at', { ascending: false }).limit(1000)
  if (!all) q = q.eq('status', 'in_stock')

  const [{ data: remnants, error }, { data: mats }, { data: cfg }, { data: cuts }] = await Promise.all([
    q,
    svc.from('b2b_materials').select('id, name, thickness, sheet_width, sheet_height, category, pattern_direction, passthrough').eq('active', true).order('name'),
    svc.from('cutting_settings').select('min_remnant_short, min_remnant_long').eq('id', 1).maybeSingle(),
    svc.from('sheet_cuts').select('id, material_name, thickness, source, sheet_w, sheet_h, created_by_name, created_at').order('created_at', { ascending: false }).limit(30),
  ])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const locations = [...new Set(((remnants ?? []) as { location: string | null }[]).map(r => r.location).filter(Boolean))]
  return NextResponse.json({
    remnants: remnants ?? [],
    cuts: cuts ?? [],
    materials: ((mats ?? []) as MaterialRow[]).filter(m => isSheetMaterial(m.category) && !m.passthrough),
    thresholds: cfg ?? { min_remnant_short: 400, min_remnant_long: 800 },
    locations,
    canWrite: ['admin', 'ceo', 'buyer', 'production'].includes(actor.role),
  })
}

// «Закрыл лист»: лист (новый или остаток со стеллажа) + куски, которые ушли на стеллаж.
export async function POST(req: NextRequest) {
  const actor = await requireInventoryWrite()
  if (actor instanceof NextResponse) return actor
  const body = await req.json().catch(() => ({})) as {
    materialId?: number; source?: 'sheet' | 'remnant'; remnantId?: number
    orderIds?: number[]; remnants?: RemnantDraft[]; note?: string
  }
  const svc = createServiceClient()

  const { data: mat } = await svc.from('b2b_materials')
    .select('id, name, thickness, sheet_width, sheet_height, category, passthrough').eq('id', Number(body.materialId)).maybeSingle()
  if (!mat) return NextResponse.json({ error: 'Выберите материал' }, { status: 400 })
  const m = mat as MaterialRow

  // Взятый остаток: тот же материал и толщина, ещё лежит
  let sheet = { w: Number(m.sheet_width) || 3210, h: Number(m.sheet_height) || 2250 }
  let taken: { id: number; width_mm: number; height_mm: number } | null = null
  if (body.source === 'remnant') {
    const { data: r } = await svc.from('sheet_remnants')
      .select('id, material_name, thickness, width_mm, height_mm, status').eq('id', Number(body.remnantId)).maybeSingle()
    if (!r || r.status !== 'in_stock') return NextResponse.json({ error: 'Этот остаток уже не на стеллаже' }, { status: 400 })
    if (r.material_name !== m.name || Number(r.thickness) !== Number(m.thickness)) {
      return NextResponse.json({ error: 'Остаток другого материала или толщины' }, { status: 400 })
    }
    taken = { id: r.id, width_mm: r.width_mm, height_mm: r.height_mm }
    sheet = { w: r.width_mm, h: r.height_mm }
  }

  const { data: cfg } = await svc.from('cutting_settings').select('min_remnant_short, min_remnant_long').eq('id', 1).maybeSingle()
  const drafts = Array.isArray(body.remnants) ? body.remnants.slice(0, 10) : []
  const { ok, errors } = checkRemnants(drafts, sheet, cfg ?? undefined)
  if (errors.length) return NextResponse.json({ error: errors.join('; ') }, { status: 400 })

  const { data: me } = await svc.from('users').select('name').eq('id', actor.userId).maybeSingle()
  const who = (me?.name as string | undefined) || actor.name || null

  const { data: cut, error: cutErr } = await svc.from('sheet_cuts').insert({
    material_id: m.id, material_name: m.name, thickness: m.thickness,
    source: taken ? 'remnant' : 'sheet', sheet_w: sheet.w, sheet_h: sheet.h, remnant_id: taken?.id ?? null,
    order_ids: (Array.isArray(body.orderIds) ? body.orderIds : []).map(Number).filter(n => Number.isInteger(n) && n > 0),
    note: body.note?.slice(0, 500) || null, created_by: actor.userId, created_by_name: who,
  }).select('id').single()
  if (cutErr || !cut) return NextResponse.json({ error: cutErr?.message ?? 'Не удалось записать лист' }, { status: 500 })

  if (taken) {
    await svc.from('sheet_remnants').update({ status: 'used', used_cut_id: cut.id, closed_by_name: who, closed_at: new Date().toISOString() })
      .eq('id', taken.id).eq('status', 'in_stock')
  }

  let codes: string[] = []
  if (ok.length) {
    const { data: rows, error: remErr } = await svc.from('sheet_remnants').insert(ok.map(d => ({
      material_id: m.id, material_name: m.name, thickness: m.thickness,
      width_mm: d.w, height_mm: d.h, location: d.location ?? null,
      from_cut_id: cut.id, created_by: actor.userId, created_by_name: who,
    }))).select('code, width_mm, height_mm')
    if (remErr) return NextResponse.json({ error: remErr.message }, { status: 500 })
    codes = ((rows ?? []) as { code: string; width_mm: number; height_mm: number }[]).map(r => `${r.code} · ${r.width_mm}×${r.height_mm}`)
  }

  return NextResponse.json({ cutId: cut.id, codes })
}
