import { describe, it, expect } from 'vitest'
import { allocateToSheets, itemsToCut, cutPriority, cutCandidates, pickCutTasks, type CutTask } from '@/lib/production/cutterPlan'
import { buildPurchaseGroups, type OrderItem } from '@/lib/purchasing/supply'
import { DEFAULT_CUTTING_SETTINGS, type PieceGroup, type CuttingPiece } from '@/lib/cuttingOptimizer'

const piece = (orderId: number, w: number, h: number, i: number): CuttingPiece => ({
  id: `${orderId}-${i}`, width: w, height: h, label: `${w}×${h}`, orderId, orderClientName: '', materialKey: 'k', canRotate: true,
})
const group = (pieces: CuttingPiece[]): PieceGroup => ({ pieces, materialLabel: 'Стекло 8 мм', category: '', sheetWidth: 3210, sheetHeight: 2250, patternDirection: 'none' })

describe('режим резчика', () => {
  it('режем только позиции с открытой резкой', () => {
    const tasks = [
      { item_index: 0, stage_key: 'cutting', status: 'done' },
      { item_index: 1, stage_key: 'cutting', status: 'open' },
      { item_index: 1, stage_key: 'tempering', status: 'open' },
    ]
    expect(itemsToCut(['a', 'b', 'c'], tasks, t => t.status === 'done').map(x => x.item)).toEqual(['b'])
    expect(itemsToCut(['a'], [], () => false)).toEqual([])
  })
  it('старые заказы первыми', () => {
    const list = [{ id: 2, no: '2', client: '', launch_day: '2026-11-20' }, { id: 1, no: '1', client: '', launch_day: '2026-11-10' }]
    expect([...list].sort(cutPriority).map(o => o.id)).toEqual([1, 2])
  })
  it('один лист: старый заказ целиком, новый — часть, лишнее не влезло', () => {
    // Лист 3210×2250: шесть деталей 1000×1000 влезают, седьмая — нет.
    const old = [0, 1, 2, 3].map(i => piece(1, 1000, 1000, i))
    const fresh = [0, 1, 2, 3].map(i => piece(2, 1000, 1000, i))
    const a = allocateToSheets(group([...fresh, ...old]), 1, DEFAULT_CUTTING_SETTINGS, new Map([[1, 0], [2, 1]]))
    expect(a.result?.sheetsNeeded).toBe(1)
    expect(a.byOrder[0]).toEqual({ orderId: 1, placed: 4, total: 4 })
    expect(a.byOrder[1].orderId).toBe(2)
    expect(a.byOrder[1].placed).toBeGreaterThan(0)
    expect(a.byOrder[1].placed).toBeLessThan(4)
    expect(a.placed.length + a.skipped.length).toBe(8)
  })
  it('ноль листов — ничего не раскладываем', () => {
    const a = allocateToSheets(group([piece(1, 500, 500, 0)]), 0, DEFAULT_CUTTING_SETTINGS, new Map())
    expect(a.placed).toEqual([])
    expect(a.skipped.length).toBe(1)
  })
})

describe('«Отрезано»: что отмечаем по раскладке', () => {
  const materials = [
    { id: 1, name: 'Стекло', thickness: 8, cost_price: 1, sheet_width: 3210, sheet_height: 2250, pattern_direction: null },
    { id: 2, name: 'Стекло', thickness: 4, cost_price: 1, sheet_width: 3210, sheet_height: 2250, pattern_direction: null },
  ]
  const build = (cut_items: OrderItem[]) => buildPurchaseGroups([{ id: 7, client: '', items: cut_items }], materials, [])

  it('позиция отмечается, только когда в раскладке все её штуки', () => {
    const cut_items = [{ item_index: 2, open_layers: [1], materialName: 'Стекло', thickness: 8, width: 500, height: 500, quantity: 5 }]
    const pieces = build(cut_items).groups.get('стекло|8')!.pieces
    expect(cutCandidates(pieces, [{ id: 7, cut_items }]).full).toEqual([{ order_id: 7, item_index: 2, layer: 1, placed: 5, total: 5 }])
    const part = cutCandidates(pieces.slice(0, 3), [{ id: 7, cut_items }])
    expect(part.full).toEqual([])
    expect(part.partial).toEqual([{ order_id: 7, item_index: 2, layer: 1, placed: 3, total: 5 }])
  })

  it('триплекс из двух толщин: каждое стекло отмечается своей раскладкой, отрезанное не повторяется', () => {
    const item = { item_index: 0, materialName: 'Стекло', thickness: 8, width: 600, height: 900, quantity: 2, hasTriplex: true, triplexGlasses: [{ materialName: 'Стекло', thickness: 4 }] }
    const both = build([{ ...item, open_layers: [1, 2] }])
    expect(cutCandidates(both.groups.get('стекло|4')!.pieces, [{ id: 7, cut_items: [item] }]).full).toEqual([{ order_id: 7, item_index: 0, layer: 2, placed: 2, total: 2 }])
    const second = build([{ ...item, open_layers: [2] }])
    expect(second.groups.has('стекло|8')).toBe(false)
  })

  it('одинаковые стёкла триплекса: половина штук — не отмечаем', () => {
    const item = { item_index: 0, materialName: 'Стекло', thickness: 4, width: 600, height: 900, quantity: 2, hasTriplex: true, open_layers: [1, 2] }
    const pieces = build([item]).groups.get('стекло|4')!.pieces
    expect(pieces.length).toBe(4)
    const r = cutCandidates(pieces.slice(0, 3), [{ id: 7, cut_items: [item] }])
    expect(r.full.map(c => c.layer)).toEqual([1])
    expect(r.partial.map(c => c.layer)).toEqual([2])
  })

  it('открытые стёкла берутся из задач', () => {
    const tasks = [
      { item_index: 0, stage_key: 'cutting', status: 'done', layer: 1 },
      { item_index: 0, stage_key: 'cutting', status: 'open', layer: 2 },
    ]
    expect(itemsToCut(['a'], tasks, t => t.status === 'done')[0].layers).toEqual([2])
  })

  it('сервер не трогает отмеченное, чужое и проблемное', () => {
    const t = (id: number, item_index: number, status: string, assigned_to: string | null = null): CutTask => ({
      id, item_index, layer: 1, status, sequence_order: 1, stage_key: 'cutting', rework_count: 0, started_at: null, assigned_to, started_by: null,
    })
    const tasks = [t(1, 0, 'queued'), t(2, 1, 'done'), t(3, 2, 'queued', 'other'), t(4, 3, 'problem'), t(5, 4, 'in_progress', 'me')]
    const r = pickCutTasks(tasks, [0, 1, 2, 3, 4, 5, 0].map(i => ({ order_id: 7, item_index: i, layer: 1 })), 'me')
    expect(r.take.map(x => x.id)).toEqual([1, 5])
    expect(r.skipped.map(s => s.reason)).toEqual(['already', 'other', 'problem', 'missing'])
  })
})
