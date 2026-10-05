import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { AI_TOOLS, executeTool } from '@/lib/ai-tools'

type Row = { id: number; product_type: string | null; tier: string; default_margin: number; tax_percent: number }

const ROWS: Row[] = [
  { id: 1, product_type: null, tier: 'standard', default_margin: 40, tax_percent: 10 },
  { id: 2, product_type: null, tier: 'budget', default_margin: 30, tax_percent: 10 },
  { id: 3, product_type: 'mirror', tier: 'standard', default_margin: 45, tax_percent: 10 },
  { id: 6, product_type: 'shower_budget', tier: 'budget', default_margin: 33, tax_percent: 10 },
  { id: 7, product_type: 'shower_standard', tier: 'standard', default_margin: 38, tax_percent: 10 },
]

// Как PostgREST: .single() на нескольких строках — ошибка, а не первая строка.
function stubClient(rows: Row[], error: { message: string } | null = null) {
  const result = { data: error ? null : rows, error }
  const builder = {
    select: vi.fn(() => builder),
    order: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    single: vi.fn(() =>
      Promise.resolve(
        rows.length === 1
          ? { data: rows[0], error: null }
          : { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned' } },
      ),
    ),
    then: (resolve: (v: typeof result) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  }
  const from = vi.fn(() => builder)
  return { client: { from } as unknown as SupabaseClient, from }
}

describe('get_financial_settings', () => {
  it('без типа — все строки, а не ошибка «multiple rows»', async () => {
    const { client, from } = stubClient(ROWS)
    const out = await executeTool('get_financial_settings', {}, client)
    expect(from).toHaveBeenCalledWith('financial_settings')
    expect(JSON.parse(out).map((r: Row) => r.id)).toEqual([1, 2, 3, 6, 7])
  })

  it('с типом — только его строки', async () => {
    const { client } = stubClient(ROWS)
    const out = await executeTool('get_financial_settings', { product_type: 'shower_standard' }, client)
    expect(JSON.parse(out)).toEqual([ROWS[4]])
  })

  it('у типа нет своей строки — общие строки по уровням', async () => {
    const { client } = stubClient(ROWS)
    const out = await executeTool('get_financial_settings', { product_type: 'loft' }, client)
    expect(JSON.parse(out).map((r: Row) => r.id)).toEqual([1, 2])
  })

  it('ошибка базы (RLS, сеть) — текстом для модели', async () => {
    const { client } = stubClient([], { message: 'permission denied for table financial_settings' })
    const out = await executeTool('get_financial_settings', {}, client)
    expect(out).toBe('Ошибка: permission denied for table financial_settings')
  })

  it('пустой ответ (RLS без политики) — пустой список', async () => {
    const { client } = stubClient([])
    expect(await executeTool('get_financial_settings', { product_type: 'mirror' }, client)).toBe('[]')
  })

  it('схема инструмента принимает product_type', () => {
    const tool = AI_TOOLS.find(t => t.name === 'get_financial_settings')
    expect(tool?.input_schema.properties).toHaveProperty('product_type')
  })
})
