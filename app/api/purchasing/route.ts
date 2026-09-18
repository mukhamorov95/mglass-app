import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { getSessionUser, getRole, isOwnerRole } from '@/lib/getRole'
import { createServiceClient } from '@/lib/supabase-service'
import { parseNotes, PROD_SINCE } from '@/lib/orderFlags'
import { mskDayKey } from '@/lib/time'
import { runCuttingOptimizer, DEFAULT_CUTTING_SETTINGS, type CuttingSettings } from '@/lib/cuttingOptimizer'
import {
  supplyState, writeFor, frontier, buildPurchaseGroups, summarizeNeeds, withThickness,
  type SupplyState, type OrderItem, type PurchaseMaterial, type SheetVariant,
} from '@/lib/purchasing/supply'

export const dynamic = 'force-dynamic'

// Материал под заказы (docs/PURCHASING_ROUTE.md). Закупщик видит заказы B2B по
// порядку добавления, отмечает «не заказан / заказан / есть», а всё не
// заказанное складывается в раскрой — сколько листов какого материала заказать.
//
// Service-role: заказы и справочник читаются целиком, поэтому роль проверяем
// здесь, до первого запроса. Пишем тем же точечным писателем, что и менеджер
// (mark_order_stages + patch_order_notes_shallow), — не блобом notes.

const ROLES = ['admin', 'ceo', 'buyer'] as const
const STATES: SupplyState[] = ['not_ordered', 'ordered', 'in_stock']

type Row = { id: number; custom_number: string | null; client_name: string | null; created_at: string; items: unknown; notes: unknown }

export async function GET(req: NextRequest) {
  const guard = await requireRole([...ROLES])
  if (guard instanceof NextResponse) return guard

  const withCut = new URL(req.url).searchParams.get('cut') === '1'
  const svc = createServiceClient()

  const { data, error } = await svc.from('b2b_orders')
    .select('id, custom_number, client_name, created_at, items, notes')
    .gte('created_at', PROD_SINCE).is('archived_at', null)
    .order('created_at', { ascending: true }).limit(2000)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = ((data ?? []) as Row[]).filter(o => {
    const n = parseNotes(o.notes)
    return n.status !== 'quote' && n.historical !== true
  })

  // Нарезан = материал уже был. Смотрим и отметку этапа, и задачу резки цеха:
  // пишут их две разные точки, и одна без другой бывает.
  const ids = rows.map(o => o.id)
  const cutByTask = new Set<number>()
  for (let i = 0; i < ids.length; i += 500) {
    const { data: tasks } = await svc.from('production_tasks')
      .select('order_id').eq('stage_key', 'cutting').eq('status', 'done').in('order_id', ids.slice(i, i + 500))
    for (const t of tasks ?? []) cutByTask.add(Number(t.order_id))
  }

  const userIds = new Set<string>()
  const all = rows.map(o => {
    const n = parseNotes(o.notes)
    const stages = (n.stages ?? {}) as Record<string, string | null>
    const items = (Array.isArray(o.items) ? o.items : []) as OrderItem[]
    const cut = !!(stages.cut || stages.packaged || stages.shipped) || cutByTask.has(o.id)
    const by = typeof n.material_status_updated_by === 'string' ? n.material_status_updated_by : null
    if (by) userIds.add(by)
    return {
      id: o.id,
      number: (o.custom_number ?? '').trim() || `№${o.id}`,
      client: o.client_name ?? '—',
      createdAt: o.created_at,
      state: supplyState(n.material_status),
      materialStatus: (n.material_status as string | undefined) ?? null,
      materialOrdered: stages.material_ordered ?? null,
      updatedAt: (n.material_status_updated_at as string | undefined) ?? null,
      updatedBy: by,
      cut,
      pieces: items.reduce((s, it) => s + Math.max(1, Number(it.quantity) || 1), 0),
      netM2: Math.round(items.reduce((s, it) => s + ((Number(it.width) || 0) * (Number(it.height) || 0) * Math.max(1, Number(it.quantity) || 1)) / 1e6, 0) * 100) / 100,
      materials: [...new Set(items.map(it => withThickness(it.materialName ?? '', it.thickness)).filter(Boolean))].slice(0, 3),
    }
  })
  // Позиции нужны только раскрою — в ответ экрану их не отдаём.
  const itemsOf = new Map(rows.map(o => [o.id, (Array.isArray(o.items) ? o.items : []) as OrderItem[]]))

  const names = new Map<string, string>()
  if (userIds.size) {
    const { data: us } = await svc.from('users').select('id, name').in('id', [...userIds])
    for (const u of us ?? []) names.set(u.id as string, (u.name as string) ?? '')
  }

  const queue = all.filter(o => withCut || !o.cut)
  const edge = frontier(queue)

  // Что заказать — только по заказам, которые ещё не нарезаны и без отметки.
  const toOrder = all.filter(o => !o.cut && o.state === 'not_ordered')
  const [{ data: mats }, { data: vars }, { data: settingsRow }] = await Promise.all([
    svc.from('b2b_materials').select('id, name, thickness, cost_price, sheet_width, sheet_height, pattern_direction').eq('active', true),
    svc.from('b2b_material_sheet_variants').select('material_id, sheet_width, sheet_height, active'),
    svc.from('cutting_settings').select('*').eq('id', 1).maybeSingle(),
  ])
  const { groups, unknown, materialByKey, extraLayerM2 } = buildPurchaseGroups(
    toOrder.map(o => ({ id: o.id, client: o.client, items: itemsOf.get(o.id) ?? [] })),
    (mats ?? []) as PurchaseMaterial[],
    (vars ?? []) as SheetVariant[],
  )
  const settings = { ...DEFAULT_CUTTING_SETTINGS, ...((settingsRow ?? {}) as Partial<CuttingSettings>) }
  const needs = summarizeNeeds(runCuttingOptimizer(groups, settings), materialByKey)

  return NextResponse.json({
    queue: queue.map(o => ({ ...o, updatedByName: o.updatedBy ? names.get(o.updatedBy) ?? null : null })),
    frontier: edge,
    counts: {
      active: all.filter(o => !o.cut).length,
      cut: all.filter(o => o.cut).length,
      toOrder: toOrder.length,
    },
    needs,
    unknown,
    totals: {
      sheets: needs.reduce((s, r) => s + r.sheets, 0),
      netM2: Math.round(needs.reduce((s, r) => s + r.netM2, 0) * 100) / 100,
      cost: needs.reduce((s, r) => s + r.cost, 0),
      unknownM2: Math.round(unknown.reduce((s, u) => s + u.m2, 0) * 100) / 100,
      // Раскрытие итога: площадь позиций заказов + вторые слои триплекса = нетто
      // в строках + не распознанное.
      // Из сырых площадей позиций: сумма уже округлённых площадей заказов
      // расходилась с итогом на копейки квадратного метра.
      itemsM2: Math.round(toOrder.reduce((s, o) => s + (itemsOf.get(o.id) ?? []).reduce((a, it) =>
        a + ((Number(it.width) || 0) * (Number(it.height) || 0) * Math.max(1, Number(it.quantity) || 1)) / 1e6, 0), 0) * 100) / 100,
      triplexM2: extraLayerM2,
    },
    toOrderIds: toOrder.map(o => o.id),
    // Карточка сделки показывает деньги и маржу — закупщику она закрыта,
    // поэтому ссылку на неё отдаём только владельцу.
    canOpenCard: isOwnerRole(await getRole()),
  })
}

// Отметка «не заказан / заказан / есть» — на один заказ или пачкой (все заказы
// из «что заказать» одной кнопкой). Каждая запись точечная, под блокировкой строки.
export async function POST(req: NextRequest) {
  const guard = await requireRole([...ROLES])
  if (guard instanceof NextResponse) return guard
  const user = await getSessionUser()

  const body = await req.json().catch(() => null) as { ids?: unknown; state?: unknown } | null
  const ids = Array.isArray(body?.ids) ? [...new Set(body.ids.map(Number).filter(Number.isFinite))] : []
  const state = STATES.includes(body?.state as SupplyState) ? (body!.state as SupplyState) : null
  if (!ids.length || !state) return NextResponse.json({ error: 'Нужны ids и состояние' }, { status: 400 })
  if (ids.length > 300) return NextResponse.json({ error: 'Слишком много за раз' }, { status: 400 })

  const svc = createServiceClient()
  const { data: rows, error } = await svc.from('b2b_orders').select('id, notes').in('id', ids)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const today = mskDayKey()
  const now = new Date().toISOString()
  const done: number[] = []
  const failed: { id: number; error: string }[] = []

  for (const r of (rows ?? []) as { id: number; notes: unknown }[]) {
    const n = parseNotes(r.notes)
    const stages = (n.stages ?? {}) as Record<string, string | null>
    const w = writeFor(state, { materialStatus: n.material_status, materialOrdered: stages.material_ordered ?? null }, today)
    const s1 = await svc.rpc('mark_order_stages', { p_order_id: r.id, p_stages: w.stages })
    if (s1.error) { failed.push({ id: r.id, error: s1.error.message }); continue }
    const s2 = await svc.rpc('patch_order_notes_shallow', {
      p_order_id: r.id,
      p_patch: { material_status: w.materialStatus, material_status_updated_at: now, material_status_updated_by: user?.id ?? null },
    })
    if (s2.error) { failed.push({ id: r.id, error: s2.error.message }); continue }
    done.push(r.id)
  }
  return NextResponse.json({ ok: failed.length === 0, done, failed })
}
