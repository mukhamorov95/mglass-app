import { readFileSync } from 'node:fs'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { calcItem } from '@/lib/b2bCalculator'
import { orderContribution, contributionRevenue } from '@/lib/unitEconomics'
import { buildProductReport } from '@/lib/cfo/productReport'
import { storedCostWithVat } from '@/lib/economics/orderCost'
import { glassUse } from '@/lib/economics/facts/physical'
import { planB2BOrder, type MatchTarget } from '@/lib/inventory/plan'
import type { StoredItem } from '@/lib/economics/facts/items'
import type { B2BMaterial } from '@/lib/types'

const h = vi.hoisted(() => ({ items: [] as unknown[], stock: [] as Record<string, unknown>[], moves: [] as Record<string, unknown>[] }))

// База на памяти: только то, что трогает списание на резке. Уникальный ключ — как в проде.
vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      const filters: [string, unknown][] = []
      let inserting: Record<string, unknown>[] | null = null
      const rows = () => (table === 'inventory_moves' ? h.moves : table === 'inventory_items' ? h.stock : []).filter(r => filters.every(([c, v]) => r[c] === v))
      const key = (m: Record<string, unknown>) => [m.doc_id, m.item_index, m.item_id, m.stage, m.attempt, m.reason].join('|')
      const run = () => {
        if (!inserting) return { data: rows(), error: null }
        if (inserting.some(a => h.moves.some(b => key(a) === key(b)))) return { data: null, error: { code: '23505', message: 'dup' } }
        h.moves.push(...inserting)
        return { data: inserting.map((_, i) => ({ id: i })), error: null }
      }
      const b: Record<string, unknown> = {}
      Object.assign(b, {
        select: () => b, order: () => b, limit: () => b, in: () => b, is: () => b, neq: () => b, not: () => b,
        eq: (c: string, v: unknown) => { filters.push([c, v]); return b },
        insert: (p: Record<string, unknown>[]) => { inserting = p; return b },
        maybeSingle: async () => ({ data: table === 'b2b_orders' ? { items: h.items } : rows()[0] ?? null, error: null }),
        then: (res: (v: unknown) => unknown) => Promise.resolve(run()).then(res),
      })
      return b
    },
  }),
}))

const mat = (id: number, thickness: number) => ({
  id, name: `Стекло ${id}`, category: 'стекло', thickness, cost_price: 1000, sale_price: 2400, waste_percent: 20,
}) as unknown as B2BMaterial
const triplex = (second: B2BMaterial) => calcItem(mat(1, 6), 800, 1000, 2, 20, false, [], false, null, [], true, 2, { salePerM2: 2000, costPerM2: 800 }, [second]) as unknown as StoredItem

describe('кромка видна и не вычитается', () => {
  const item = calcItem(mat(1, 6), 600, 900, 2, 20, true) as unknown as StoredItem
  const c = orderContribution(20000, [item])

  it('отдельным блоком своих операций', () => {
    expect(c.own.map(l => [l.key, l.amount])).toEqual([['edge', item.costEdge]])
    expect(c.lines.some(l => l.key === 'edge')).toBe(false)
  })

  it('переменные + свои операции = сохранённая себестоимость', () => {
    expect(c.variable + c.ownTotal).toBe(item.costWithVat)
  })

  it('«остаётся» не изменилось от появления блока', () => {
    expect(c.contribution).toBe(orderContribution(20000, [{ ...item, costEdge: 0 }]).contribution)
  })
})

describe('переделка за наш счёт', () => {
  const order = { total_after_discount: 16623, notes: JSON.stringify({ own_cost_remake: { of: '05722' } }) }

  it('выручка 0, затраты остаются', () => {
    expect(contributionRevenue(order)).toBe(0)
    expect(contributionRevenue({ ...order, notes: '{}' })).toBe(16623)
    const c = orderContribution(contributionRevenue(order), [{ category: 'стекло', quantity: 1, totalAreaNet: 1, costMaterial: 5000 }])
    expect(c).toMatchObject({ revenue: 0, variable: 5000, contributionPct: 0 })
    expect(c.contribution).toBeLessThan(0)
  })

  it('в отчёте по изделиям — тоже без выручки', () => {
    const base = { id: 1, launched_at: '2026-11-02', discount_percent: 0, total_after_discount: 12200, total_sale_inc_vat: 12200,
      items: [{ category: 'стекло', materialName: 'Стекло', thickness: 6, quantity: 1, totalAreaNet: 1, saleIncVat: 12200, costExVat: 5000 }] }
    const report = buildProductReport([{ ...base, notes: order.notes }])
    expect(report.total).toMatchObject({ revenueExVat: 0, costExVat: 5000 })
    expect(report.ordersIncVat).toBe(0)
    expect(buildProductReport([base]).total.revenueExVat).toBe(10000)
  })
})

describe('себестоимость из сохранённого: входной НДС — не себестоимость', () => {
  it.each([
    ['из позиций', { items: [{ costWithVat: 700 }, { costWithVat: 300 }], total_cost_vat: 180, total_cost_net: 820 }, 1000],
    ['позиций нет — без НДС плюс НДС', { items: [], total_cost_net: 820, total_cost_vat: 180 }, 1000],
    ['есть только НДС', { total_cost_vat: 180 }, null],
    ['есть только без НДС', { total_cost_net: 820 }, null],
    ['ничего нет', {}, null],
  ])('%s', (_n, o, want) => { expect(storedCostWithVat(o)).toBe(want) })
})

describe('физический расход многослойного', () => {
  const stock = (id: number, ref: number): MatchTarget & { active: boolean } =>
    ({ id, name: `Стекло ${ref}`, unit: 'м2', qty: 100, ref_table: 'b2b_materials', ref_id: String(ref), bom_aliases: [], active: true })

  it('каждое стекло берёт расход одной площади; totalAreaBilled не изменён', () => {
    const it_ = triplex(mat(2, 4))
    expect(it_.totalAreaBilled).toBeCloseTo(1.92, 4)
    expect(glassUse(it_).map(g => [g.layer, g.materialId, g.m2])).toEqual([[1, 1, 1.92], [2, 2, 1.92]])
    expect(planB2BOrder([it_ as never], [stock(10, 1), stock(20, 2)]).map(r => [r.item_id, r.qty])).toEqual([[10, 1.92], [20, 1.92]])
  })

  it('одинаковые стёкла складываются; обычная позиция и изделие — по-прежнему один расход', () => {
    expect(planB2BOrder([triplex(mat(1, 6)) as never], [stock(10, 1)]).map(r => r.qty)).toEqual([3.84])
    expect(glassUse({ category: 'стекло', materialId: 1, totalAreaBilled: 1.5 })).toHaveLength(1)
    expect(glassUse({ category: 'изделие', materialId: 0, totalAreaBilled: 0.6, hasTriplex: true })).toHaveLength(1)
  })

  describe('списание на резке', () => {
    beforeEach(() => {
      h.moves = []
      h.stock = [stock(10, 1), stock(20, 2)] as never
    })
    const run = async () => (await import('@/lib/inventory/db')).consumeItemAtStage('5', 0, 0, 'cutting', {})

    it('два материала — два движения; повтор ничего не удваивает', async () => {
      h.items = [triplex(mat(2, 4))]
      expect(await run()).toMatchObject({ matched: true, inserted: 2, qty: 3.84 })
      expect(await run()).toMatchObject({ inserted: 0 })
      expect(h.moves.map(m => [m.item_id, m.qty])).toEqual([[10, -1.92], [20, -1.92]])
    })

    it('одинаковые стёкла — одно движение на двойную площадь', async () => {
      h.items = [triplex(mat(1, 6))]
      await run()
      expect(h.moves.map(m => [m.item_id, m.qty])).toEqual([[10, -3.84]])
    })

    it('второго стекла нет на складе — первое списано, пропуск назван', async () => {
      h.items = [triplex(mat(9, 4))]
      await run()
      expect(h.moves).toHaveLength(1)
      expect(h.moves[0].note).toContain('нет на складе: Стекло 9')
    })

    it('позже появившийся материал дописывается повтором', async () => {
      h.items = [triplex(mat(2, 4))]
      h.stock = [stock(10, 1)] as never
      await run()
      h.stock = [stock(10, 1), stock(20, 2)] as never
      expect(await run()).toMatchObject({ inserted: 1 })
    })
  })
})

describe('нормы расхода: каждый экран читает всё, по чему строится норма', () => {
  const screens = ['app/b2b-quotes/page.tsx', 'app/cfo/order-economics/page.tsx', 'app/cfo/order-economics/[id]/page.tsx']
  it.each(screens)('%s', (file) => {
    const src = readFileSync(file, 'utf8')
    expect(src).toContain('buildWasteNorms(')
    const selects = [...src.matchAll(/from\('b2b_materials'\)\.select\('([^']+)'\)/g)].map(m => m[1].split(',').map(c => c.trim()))
    expect(selects.length).toBeGreaterThan(0)
    for (const cols of selects) {
      expect(cols).toEqual(expect.arrayContaining(['id', 'name', 'thickness', 'category', 'waste_percent']))
    }
  })
})
