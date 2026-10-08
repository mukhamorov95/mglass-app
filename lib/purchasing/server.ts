import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isOrderCut, parseNotes, PROD_SINCE } from '@/lib/orderFlags'
import { readPaged, readIn } from '@/lib/production/paged'
import { runCuttingOptimizer, DEFAULT_CUTTING_SETTINGS, type CuttingSettings } from '@/lib/cuttingOptimizer'
import {
  supplyState, writeFor, shopRequestMove, buildPurchaseGroups, summarizeNeeds, withThickness,
  type SupplyState, type OrderItem, type PurchaseMaterial, type SheetVariant,
} from '@/lib/purchasing/supply'

// Серверная часть «Материала под заказы»: загрузка заказов, расчёт раскроя и
// запись отметки. Экрану и заказу поставщику нужен ОДИН И ТОТ ЖЕ расчёт — иначе
// в заказе поставщику окажется не то, что закупщик видел на экране.

export type ActiveOrder = {
  id: number; number: string; client: string; createdAt: string
  state: SupplyState; materialStatus: string | null; materialOrdered: string | null
  updatedAt: string | null; updatedBy: string | null
  cut: boolean; pieces: number; netM2: number; materials: string[]
  items: OrderItem[]
  // Цех нажал «Нет мат.» и ещё не сказал «пришёл»: его плашка и его заявка закупщику.
  shopWaiting: boolean; shopWaitingSince: string | null
}

// Заявки цеха, которые ещё не закрыты (need → ordered → arrived).
export const OPEN_SHOP_REQUEST = ['need', 'ordered']

type Row = { id: number; custom_number: string | null; client_name: string | null; created_at: string; items: unknown; notes: unknown }

const areaOf = (it: OrderItem) => ((Number(it.width) || 0) * (Number(it.height) || 0) * Math.max(1, Number(it.quantity) || 1)) / 1e6

export async function loadOrders(svc: SupabaseClient, onlyIds?: number[]): Promise<ActiveOrder[]> {
  // Страницами: .limit(2000) не поднимает потолок PostgREST в 1000 строк, а активных
  // заказов с 07.07 уже за 700.
  const data = await readPaged<Row>((from, to) => {
    let q = svc.from('b2b_orders')
      .select('id, custom_number, client_name, created_at, items, notes')
      .gte('created_at', PROD_SINCE).is('archived_at', null)
      .order('created_at', { ascending: true }).order('id', { ascending: true })
    if (onlyIds?.length) q = q.in('id', onlyIds)
    return q.range(from, to)
  })

  const rows = data.filter(o => {
    const n = parseNotes(o.notes)
    return n.status !== 'quote' && n.historical !== true
  })

  // Нарезан = материал уже был. Смотрим и отметку этапа, и задачу резки цеха:
  // пишут их две разные точки, и одна без другой бывает.
  const ids = rows.map(o => o.id)
  // Задач резки — по одной на позицию: 500 заказов дают больше 1000 строк, дочитываем.
  const cutTasks = await readIn<{ order_id: number }, number>(ids, (part, from, to) =>
    svc.from('production_tasks').select('id, order_id').eq('stage_key', 'cutting').eq('status', 'done')
      .in('order_id', part).order('id', { ascending: true }).range(from, to))
  const cutByTask = new Set(cutTasks.map(t => Number(t.order_id)))

  const reqs = await readIn<{ b2b_order_id: number; created_at: string }, number>(ids, (part, from, to) =>
    svc.from('shop_purchase_requests').select('id, b2b_order_id, created_at')
      .in('b2b_order_id', part).in('status', OPEN_SHOP_REQUEST).order('id', { ascending: true }).range(from, to))
  const waitingSince = new Map<number, string>()
  for (const r of reqs) if (!waitingSince.has(Number(r.b2b_order_id))) waitingSince.set(Number(r.b2b_order_id), r.created_at)

  return rows.map(o => {
    const n = parseNotes(o.notes)
    const itemsWaiting = Array.isArray(n.material_needed_items) && n.material_needed_items.length > 0
    const stages = (n.stages ?? {}) as Record<string, string | null>
    const items = (Array.isArray(o.items) ? o.items : []) as OrderItem[]
    return {
      id: o.id,
      number: (o.custom_number ?? '').trim() || `№${o.id}`,
      client: o.client_name ?? '—',
      createdAt: o.created_at,
      state: supplyState(n.material_status),
      materialStatus: (n.material_status as string | undefined) ?? null,
      materialOrdered: stages.material_ordered ?? null,
      updatedAt: (n.material_status_updated_at as string | undefined) ?? null,
      updatedBy: typeof n.material_status_updated_by === 'string' ? n.material_status_updated_by : null,
      cut: isOrderCut(stages, cutByTask.has(o.id)),
      pieces: items.reduce((s, it) => s + Math.max(1, Number(it.quantity) || 1), 0),
      netM2: Math.round(items.reduce((s, it) => s + areaOf(it), 0) * 100) / 100,
      materials: [...new Set(items.map(it => withThickness(it.materialName ?? '', it.thickness)).filter(Boolean))].slice(0, 3),
      items,
      shopWaiting: n.material_status === 'needed' || itemsWaiting || waitingSince.has(o.id),
      shopWaitingSince: waitingSince.get(o.id)
        ?? (n.material_status === 'needed' && typeof n.material_checked_at === 'string' ? n.material_checked_at : null),
    }
  })
}

export async function computeNeeds(svc: SupabaseClient, orders: ActiveOrder[]) {
  const [{ data: mats }, { data: vars }, { data: settingsRow }] = await Promise.all([
    svc.from('b2b_materials').select('id, name, thickness, category, cost_price, sheet_width, sheet_height, pattern_direction').eq('active', true),
    svc.from('b2b_material_sheet_variants').select('material_id, sheet_width, sheet_height, active'),
    svc.from('cutting_settings').select('*').eq('id', 1).maybeSingle(),
  ])
  const { groups, unknown, materialByKey, extraLayerM2, resolved } = buildPurchaseGroups(
    orders.map(o => ({ id: o.id, client: o.client, items: o.items })),
    (mats ?? []) as PurchaseMaterial[],
    (vars ?? []) as SheetVariant[],
  )
  const settings = { ...DEFAULT_CUTTING_SETTINGS, ...((settingsRow ?? {}) as Partial<CuttingSettings>) }
  const needs = summarizeNeeds(runCuttingOptimizer(groups, settings), materialByKey)
  // Из сырых площадей позиций: сумма уже округлённых площадей заказов
  // расходилась с итогом на сотые квадратного метра.
  const itemsM2 = Math.round(orders.reduce((s, o) => s + o.items.reduce((a, it) => a + areaOf(it), 0), 0) * 100) / 100
  return { needs, unknown, extraLayerM2, itemsM2, resolved }
}

// Отметка — тем же точечным писателем, что у менеджера: этап через
// mark_order_stages, статус через patch_order_notes_shallow, под блокировкой строки.
// Если цех ждёт этот материал — его заявка двигается следом (shopRequestMove).
export async function writeSupply(
  svc: SupabaseClient,
  orders: { id: number; materialStatus: string | null; materialOrdered: string | null; shopWaiting?: boolean }[],
  state: SupplyState,
  opts: { today: string; userId: string | null; fromPurchase?: boolean; expectedDate?: string | null },
): Promise<{ done: number[]; failed: { id: number; error: string }[]; shopFailed: { id: number; error: string }[] }> {
  const now = new Date().toISOString()
  const done: number[] = []
  const failed: { id: number; error: string }[] = []
  const shopFailed: { id: number; error: string }[] = []

  let byName: string | null = null
  if (opts.userId && orders.some(o => o.shopWaiting)) {
    const { data } = await svc.from('users').select('name').eq('id', opts.userId).maybeSingle()
    byName = (data as { name?: string | null } | null)?.name ?? null
  }
  const move = shopRequestMove(state, now, byName ?? 'Закупка', opts.expectedDate ?? null)

  for (const o of orders) {
    const w = writeFor(state, { materialStatus: o.materialStatus, materialOrdered: o.materialOrdered }, opts.today,
      { fromPurchase: opts.fromPurchase, shopWaiting: o.shopWaiting })
    const s1 = await svc.rpc('mark_order_stages', { p_order_id: o.id, p_stages: w.stages })
    if (s1.error) { failed.push({ id: o.id, error: s1.error.message }); continue }
    const s2 = await svc.rpc('patch_order_notes_shallow', {
      p_order_id: o.id,
      p_patch: { material_status: w.materialStatus, material_status_updated_at: now, material_status_updated_by: opts.userId },
    })
    if (s2.error) { failed.push({ id: o.id, error: s2.error.message }); continue }
    done.push(o.id)

    if (!o.shopWaiting) continue
    const r1 = await svc.from('shop_purchase_requests').update(move.patch).eq('b2b_order_id', o.id).in('status', move.fromStatuses)
    if (r1.error) { shopFailed.push({ id: o.id, error: r1.error.message }); continue }
    if (state === 'ordered' && opts.expectedDate) {
      const r2 = await svc.from('shop_purchase_requests').update({ expected_date: opts.expectedDate })
        .eq('b2b_order_id', o.id).eq('status', 'ordered').is('expected_date', null)
      if (r2.error) shopFailed.push({ id: o.id, error: r2.error.message })
    }
  }
  return { done, failed, shopFailed }
}
