import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { duplicateOrder, type DuplicableOrder } from '@/lib/b2b/duplicateOrder'

function fakeSb() {
  const inserted: Record<string, unknown>[] = []
  const sb = {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        inserted.push(row)
        return { select: () => ({ single: async () => ({ data: { id: 99, ...row }, error: null }) }) }
      },
    }),
  } as unknown as SupabaseClient
  return { sb, inserted }
}

const order: DuplicableOrder = {
  client_id: 5, client_name: 'M GLASS', discount_percent: 0, margin_percent: 30,
  items: [{ width: 100 }], total_area: 1, total_weight: 2, total_cost_net: 10, total_cost_vat: 12,
  total_sale_inc_vat: 100, total_after_discount: 90,
  notes: JSON.stringify({ status: 'launched', production_days: 7, stages: { cut: '2026-10-01' }, repeated_from: 1 }),
}

describe('копия заказа черновиком', () => {
  it('«Повторить» помечает источник, этапы исходного не переносит', async () => {
    const { sb, inserted } = fakeSb()
    const { data, error } = await duplicateOrder(sb, order, { managerName: 'Яна', repeatedFrom: 5648 })
    expect(error).toBeNull()
    expect(data?.id).toBe(99)
    const notes = JSON.parse(String(inserted[0].notes))
    expect(notes).toMatchObject({ status: 'quote', manager_name: 'Яна', production_days: 7, repeated_from: 5648 })
    expect(notes.stages).toBeUndefined()
    expect(inserted[0]).toMatchObject({ margin_percent: 30, total_cost_vat: 12, created_by: 'u1' })
  })

  it('«Дублировать» без пометки: унаследованный repeated_from не тянется в копию', async () => {
    const { sb, inserted } = fakeSb()
    await duplicateOrder(sb, order)
    expect(JSON.parse(String(inserted[0].notes)).repeated_from).toBeUndefined()
  })
})
