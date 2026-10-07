import { describe, it, expect } from 'vitest'
import { readPaged, readIn, chunks, PAGE, IN_CHUNK } from '@/lib/production/paged'

// Поддельный PostgREST: отдаёт не больше PAGE строк за запрос, как настоящий.
const table = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i + 1 }))
const fakePage = (rows: { id: number }[]) => (from: number, to: number) =>
  Promise.resolve({ data: rows.slice(from, Math.min(to + 1, from + PAGE)), error: null })

describe('чтение страницами — потолок 1000 строк', () => {
  it('2 345 строк читаются целиком, а не первой тысячей', async () => {
    const rows = await readPaged(fakePage(table(2345)))
    expect(rows).toHaveLength(2345)
    expect(rows[2344]).toEqual({ id: 2345 })
  })

  it('ровно 1000 строк — дочитывает пустую страницу и останавливается', async () => {
    let calls = 0
    const rows = await readPaged((from, to) => { calls++; return fakePage(table(1000))(from, to) })
    expect(rows).toHaveLength(1000)
    expect(calls).toBe(2)
  })

  it('ошибка страницы — исключение, а не короткий список', async () => {
    const page = (from: number) => Promise.resolve(from === 0
      ? { data: table(PAGE), error: null }
      : { data: null, error: { message: 'timeout' } })
    await expect(readPaged(page)).rejects.toThrow('timeout')
  })
})

describe('пачки id', () => {
  it('режет по 500', () => {
    expect(chunks(Array.from({ length: 1201 }, (_, i) => i)).map(c => c.length)).toEqual([IN_CHUNK, IN_CHUNK, 201])
    expect(chunks([])).toEqual([])
  })

  it('каждая пачка дочитывается страницами', async () => {
    const ids = Array.from({ length: 700 }, (_, i) => i + 1)
    const seen: number[][] = []
    const rows = await readIn(ids, (part, from, to) => {
      if (from === 0) seen.push(part)
      // На каждый id — по 3 строки: на 500 id это 1500 строк, больше страницы.
      const all = part.flatMap(id => [{ id }, { id }, { id }])
      return Promise.resolve({ data: all.slice(from, to + 1), error: null })
    })
    expect(seen.map(p => p.length)).toEqual([500, 200])
    expect(rows).toHaveLength(2100)
  })

  it('пустой список id — без запросов', async () => {
    let calls = 0
    const rows = await readIn([], () => { calls++; return Promise.resolve({ data: [], error: null }) })
    expect(rows).toEqual([])
    expect(calls).toBe(0)
  })
})
