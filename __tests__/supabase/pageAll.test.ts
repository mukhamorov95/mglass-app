import { describe, it, expect } from 'vitest'
import { pageAll, inChunks, type PageResult } from '@/lib/supabase/pageAll'

// Подделка PostgREST: как прод — отдаёт не больше 1000 строк, сколько бы ни попросили.
const CAP = 1000
function fakeTable(n: number) {
  const rows = Array.from({ length: n }, (_, i) => ({ id: i + 1 }))
  const calls: Array<[number, number]> = []
  const range = (from: number, to: number): Promise<PageResult<{ id: number }>> => {
    calls.push([from, to])
    const end = Math.min(to + 1, from + CAP)
    return Promise.resolve({ data: rows.slice(from, end), error: null })
  }
  return { range, calls }
}

describe('pageAll', () => {
  it('прямой .range(0, 4999) у подделки режется до 1000 — то, от чего защищаемся', async () => {
    const t = fakeTable(3400)
    const { data } = await t.range(0, 4999)
    expect(data).toHaveLength(1000)
  })

  it('дочитывает все 3400 строк страницами по 1000', async () => {
    const t = fakeTable(3400)
    const rows = await pageAll((from, to) => t.range(from, to))
    expect(rows).toHaveLength(3400)
    expect(new Set(rows.map(r => r.id)).size).toBe(3400)
    expect(t.calls).toEqual([[0, 999], [1000, 1999], [2000, 2999], [3000, 3999]])
  })

  it('ровно 2000 строк — лишняя пустая страница, но без потерь', async () => {
    const t = fakeTable(2000)
    const rows = await pageAll((from, to) => t.range(from, to))
    expect(rows).toHaveLength(2000)
    expect(t.calls).toHaveLength(3)
  })

  it('пустая таблица и data: null — пустой массив', async () => {
    expect(await pageAll(() => Promise.resolve({ data: null, error: null }))).toEqual([])
  })

  it('ошибку базы бросает, а не глотает', async () => {
    await expect(pageAll(() => Promise.resolve({ data: null, error: { message: 'boom' } }))).rejects.toThrow('boom')
  })

  it('ошибка на второй странице не отдаёт половину', async () => {
    const t = fakeTable(3400)
    const build = (from: number, to: number) =>
      from >= 1000 ? Promise.resolve({ data: null, error: { message: 'timeout' } }) : t.range(from, to)
    await expect(pageAll(build)).rejects.toThrow('timeout')
  })

  it('стоп-кран maxRows — понятная ошибка', async () => {
    const t = fakeTable(5000)
    await expect(pageAll((f, to) => t.range(f, to), { maxRows: 2000 })).rejects.toThrow(/стоп-крана 2000/)
  })

  it('pageSize меньше потолка работает так же', async () => {
    const t = fakeTable(1234)
    const rows = await pageAll((f, to) => t.range(f, to), { pageSize: 500 })
    expect(rows).toHaveLength(1234)
  })
})

describe('inChunks', () => {
  it('режет на пачки и склеивает результат по порядку', async () => {
    const ids = Array.from({ length: 1201 }, (_, i) => i)
    const sizes: number[] = []
    const out = await inChunks(ids, 500, async part => { sizes.push(part.length); return part.map(x => x * 2) })
    expect(sizes).toEqual([500, 500, 201])
    expect(out).toHaveLength(1201)
    expect(out[1200]).toBe(2400)
  })

  it('пустой список — ни одного вызова', async () => {
    let calls = 0
    expect(await inChunks([], 500, async () => { calls++; return [] })).toEqual([])
    expect(calls).toBe(0)
  })
})
