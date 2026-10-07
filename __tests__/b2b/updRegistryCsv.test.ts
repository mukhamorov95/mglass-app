import { describe, it, expect } from 'vitest'
import { updQueue, type QueueOrder } from '@/lib/b2b/updQueue'
import { csvCell, registryXlsx, updRegistryCsv, updRegistryTable, updRegistryTotals, updSeriesGaps, type UpdRegistryRow } from '@/lib/b2b/updRegistryCsv'

const row = (p: Partial<UpdRegistryRow>): UpdRegistryRow => ({
  year: 2026, number: 533, doc_date: '2026-10-07', b2b_order_id: 5544, order_number: '05544',
  buyer_name: 'ООО «Ромашка»', buyer_inn: '7700000000', buyer_kpp: '770001001',
  sum_no_vat: 10_000, vat: 2_200, sum_inc_vat: 12_200,
  issued_at: '2026-10-07T09:00:00Z', issued_by_name: 'Яна', ...p,
})

describe('CSV реестра УПД для книги продаж', () => {
  it('BOM, «;», запятая в дробной части, без разрядных пробелов, строка «Итого»', () => {
    const csv = updRegistryCsv([row({}), row({ number: 534, b2b_order_id: 5545, order_number: '05545', sum_no_vat: 1234.5, vat: 271.59, sum_inc_vat: 1506.09 })])
    expect(csv.startsWith('﻿')).toBe(true)
    const lines = csv.slice(1).trimEnd().split('\r\n')
    expect(lines).toHaveLength(4)
    expect(lines[1]).toBe('1;01;533;07.10.2026;ООО «Ромашка»;7700000000;770001001;22;10000,00;2200,00;12200,00;05544')
    expect(lines[2]).toBe('2;01;534;07.10.2026;ООО «Ромашка»;7700000000;770001001;22;1234,50;271,59;1506,09;05545')
    expect(lines[3]).toBe('Итого;;2;;;;;;11234,50;2471,59;13706,09;')
  })

  it('строки идут по номеру, а не по порядку выдачи', () => {
    const t = updRegistryTable([row({ number: 540 }), row({ number: 533 })])
    expect(t.body.map(r => r[2])).toEqual([533, 540])
    expect(t.body.map(r => r[0])).toEqual([1, 2])
  })

  it('отгрузка 2025 года — ставка 20 %', () => {
    expect(updRegistryTable([row({ doc_date: '2025-12-30' })]).body[0][7]).toBe(20)
  })

  it('ИНН с ведущим нулём остаётся строкой', () => {
    const t = updRegistryTable([row({ buyer_inn: '0105012345' })])
    expect(t.body[0][5]).toBe('0105012345')
  })

  it('кавычки и «;» в названии не ломают колонки, формула не исполняется', () => {
    expect(csvCell('ООО "Ромашка; филиал"')).toBe('"ООО ""Ромашка; филиал"""')
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`)
    expect(csvCell('-15,00')).toBe('-15,00')
    expect(csvCell(null)).toBe('')
  })

  it('итог складывается копейками и не плывёт', () => {
    const rows = Array.from({ length: 10 }, () => row({ sum_no_vat: 0.1, vat: 0.02, sum_inc_vat: 0.12 }))
    expect(updRegistryTotals(rows)).toEqual({ count: 10, sumNoVat: 1, vat: 0.2, sumIncVat: 1.2 })
  })

  it('пустой реестр — заголовок и нулевой итог', () => {
    const lines = updRegistryCsv([]).slice(1).trimEnd().split('\r\n')
    expect(lines).toHaveLength(2)
    expect(lines[1]).toBe('Итого;;0;;;;;;0,00;0,00;0,00;')
  })
})

describe('пропуски в серии', () => {
  it('от первого номера серии до последнего выданного', () => {
    expect(updSeriesGaps(533, [533, 534, 536])).toEqual([535])
    expect(updSeriesGaps(533, [535])).toEqual([533, 534])
    expect(updSeriesGaps(533, [])).toEqual([])
  })
})

describe('ждут УПД', () => {
  const o = (p: Partial<QueueOrder> & { shipped?: unknown }): QueueOrder => {
    const { shipped, ...rest } = p
    return {
      id: 1, custom_number: '05600', client_id: 10, client_name: 'Ромашка',
      notes: JSON.stringify({ stages: shipped === undefined ? {} : { shipped } }),
      created_at: '2026-10-01T10:00:00Z', launched_at: '2026-10-01T10:00:00Z',
      total_after_discount: 12_200, total_sale_inc_vat: 12_200, ...rest,
    }
  }
  const inn = new Set([10])

  it('отгружено после переключения, ИНН есть, УПД нет — в списке', () => {
    const q = updQueue([o({ shipped: '2026-10-08T09:00:00Z' })], new Set(), inn, '2026-10-08')
    expect(q.rows).toEqual([{ id: 1, ref: '05600', client: 'Ромашка', shippedDay: '2026-10-08', total: 12_200 }])
  })

  it('до переключения, выданные, не отгруженные и не запущенные — не в списке', () => {
    const q = updQueue([
      o({ id: 1, shipped: '2026-10-07' }),
      o({ id: 2, shipped: '2026-10-09' }),
      o({ id: 3 }),
      o({ id: 4, shipped: '2026-10-09', launched_at: null }),
    ], new Set([2]), inn, '2026-10-08')
    expect(q.rows).toEqual([])
  })

  it('без ИНН — отдельным числом, а не строкой списка', () => {
    const q = updQueue([o({ client_id: 11, shipped: '2026-10-09' }), o({ client_id: null, shipped: '2026-10-09' })], new Set(), inn, '2026-10-08')
    expect(q.rows).toEqual([])
    expect(q.noInn).toBe(2)
  })

  it('«Отгружен» без даты считается только у заказов после переключения', () => {
    const q = updQueue([
      o({ id: 1, shipped: true, created_at: '2026-09-20T10:00:00Z' }),
      o({ id: 2, shipped: true, created_at: '2026-10-09T10:00:00Z' }),
    ], new Set(), inn, '2026-10-08')
    expect(q.undated).toBe(1)
    expect(q.rows).toEqual([])
  })
})

describe('Excel реестра УПД', () => {
  it('ИНН и КПП — текст с ведущим нулём, суммы — числа, итог внизу', async () => {
    const XLSX = await import('xlsx')
    const buf = await registryXlsx([row({ buyer_inn: '0105012345', buyer_kpp: '010501001' })])
    const ws = XLSX.read(buf, { type: 'buffer' }).Sheets['Реестр УПД']
    expect(ws.F2).toMatchObject({ t: 's', v: '0105012345' })
    expect(ws.G2).toMatchObject({ t: 's', v: '010501001' })
    expect(ws.K2).toMatchObject({ t: 'n', v: 12_200 })
    expect(ws.A3.v).toBe('Итого')
    expect(ws.K3).toMatchObject({ t: 'n', v: 12_200 })
  })
})
