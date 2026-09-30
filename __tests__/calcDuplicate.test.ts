import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildDuplicate, type DuplicateSource } from '@/lib/calcDuplicate'
import { seesAllCalculations } from '@/lib/calcAccess'

const src: DuplicateSource = {
  id: 77,
  created_by: 'author-uuid',
  product_type: 'mirror',
  input_data: { width: 800, height: 600 },
  cost_breakdown: { totalCost: 9000 },
  financial_breakdown: { serviceLines: [] },
  base_price: 15000,
  discount: 5,
  partner_percent: 0,
  final_price: 14250,
  margin: 36.8,
  profit: 5250,
  manager_bonus: 300,
  client_text: 'Зеркало 800×600',
  client_name: 'Иван',
  client_phone: '+7 999 123-45-67',
}

describe('дублирование расчёта', () => {
  it('копия — черновик того, кто нажал, с теми же деньгами и клиентом', () => {
    const r = buildDuplicate(src, 'caller-uuid')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.row).toMatchObject({
      product_type: 'mirror', final_price: 14250, base_price: 15000, margin: 36.8, profit: 5250,
      discount: 5, manager_bonus: 300, client_name: 'Иван', client_phone: '+7 999 123-45-67',
      input_data: { width: 800, height: 600 }, created_by: 'caller-uuid', status: 'draft',
    })
  })

  it('сделка, заказ и связь пересчёта не копируются', () => {
    const r = buildDuplicate(src, 'caller-uuid')
    if (!r.ok) throw new Error(r.error)
    for (const k of ['id', 'deal_id', 'order_group_id', 'order_number', 'parent_calc_id', 'created_at']) {
      expect(r.row, k).not.toHaveProperty(k)
    }
  })

  it('«Расчёт» без клиента не копируется — тот же инвариант, что у сохранения', () => {
    const r = buildDuplicate({ ...src, product_type: 'build', client_name: null, client_phone: null }, 'caller-uuid')
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.error).toContain('имя клиента')
  })

  it('битая маржа не копируется', () => {
    const r = buildDuplicate({ ...src, margin: 120 }, 'caller-uuid')
    expect(r.ok).toBe(false)
  })

  it('тип, который больше не сохраняется, — отказ с причиной, а не вставка', () => {
    const r = buildDuplicate({ ...src, product_type: 'shower_budget' }, 'caller-uuid')
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.error).toContain('shower_budget')
  })
})

function usersClient(res: { data: unknown; error: { message: string } | null }) {
  let asked = 0
  const client = {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => { asked++; return res } }) }) }),
  } as unknown as SupabaseClient
  return { client, asked: () => asked }
}

describe('кто видит все расчёты (список и дублирование чужого)', () => {
  it('владелец — без запроса к users', async () => {
    const u = usersClient({ data: null, error: null })
    expect(await seesAllCalculations(u.client, 'x', 'admin')).toBe(true)
    expect(await seesAllCalculations(u.client, 'x', 'ceo')).toBe(true)
    expect(u.asked()).toBe(0)
  })

  it('менеджер — только с галкой «Все сделки»', async () => {
    expect(await seesAllCalculations(usersClient({ data: { can_view_all_deals: true }, error: null }).client, 'x', 'manager')).toBe(true)
    expect(await seesAllCalculations(usersClient({ data: { can_view_all_deals: false }, error: null }).client, 'x', 'manager')).toBe(false)
    expect(await seesAllCalculations(usersClient({ data: null, error: null }).client, 'x', 'manager')).toBe(false)
  })

  it('ошибка чтения прав — ошибка, а не «видит только свои»', async () => {
    await expect(seesAllCalculations(usersClient({ data: null, error: { message: 'timeout' } }).client, 'x', 'manager'))
      .rejects.toThrow('timeout')
  })
})
