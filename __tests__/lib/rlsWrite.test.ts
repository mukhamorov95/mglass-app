import { describe, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { writeFailure, NOT_SAVED_NO_RIGHTS, NOT_DELETED_NO_RIGHTS } from '@/lib/rlsWrite'

describe('writeFailure', () => {
  it('строка вернулась — записано', () => {
    expect(writeFailure({ data: [{ id: 1 }], error: null })).toBeNull()
    expect(writeFailure({ data: [{ id: 1 }], error: null }, 'delete')).toBeNull()
  })

  it('ноль строк без ошибки — отказ RLS, а не успех', () => {
    expect(writeFailure({ data: [], error: null })).toBe(NOT_SAVED_NO_RIGHTS)
    expect(writeFailure({ data: [], error: null }, 'delete')).toBe(NOT_DELETED_NO_RIGHTS)
  })

  it('data null (запись без .select) тоже не считается успехом', () => {
    expect(writeFailure({ data: null, error: null })).toBe(NOT_SAVED_NO_RIGHTS)
  })

  it('ошибка базы показывается человеку', () => {
    expect(writeFailure({ data: null, error: { message: 'сеть' } })).toBe('Не сохранено: сеть')
    expect(writeFailure({ data: null, error: { message: 'сеть' } }, 'delete')).toBe('Не удалено: сеть')
  })
})

// Ответ PostgREST на UPDATE, который RLS отфильтровал: 200 и пустой массив (с
// return=representation) или 204 без тела. Проверяем, что supabase-js отдаёт это
// как { error: null } — то есть по одному error отказ не виден.
function clientAnswering(status: number, body: string | null) {
  const fetchStub = async () => new Response(body, { status, headers: { 'content-type': 'application/json' } })
  return createClient('https://example.supabase.co', 'anon-key', { global: { fetch: fetchStub as typeof fetch } })
}

describe('supabase-js на отказ RLS', () => {
  it('update без .select(): error null — старая проверка сказала бы «Сохранено»', async () => {
    const res = await clientAnswering(204, null).from('facet_prices').update({ cost_price: 1 }).eq('id', 1)
    expect(res.error).toBeNull()
    expect(writeFailure(res as never)).toBe(NOT_SAVED_NO_RIGHTS)
  })

  it('update с .select("id"): пустой массив — «нет прав на правку»', async () => {
    const res = await clientAnswering(200, '[]').from('facet_prices').update({ cost_price: 1 }).eq('id', 1).select('id')
    expect(res.error).toBeNull()
    expect(res.data).toEqual([])
    expect(writeFailure(res)).toBe(NOT_SAVED_NO_RIGHTS)
  })

  it('update с .select("id"): строка вернулась — сохранено', async () => {
    const res = await clientAnswering(200, '[{"id":1}]').from('facet_prices').update({ cost_price: 1 }).eq('id', 1).select('id')
    expect(writeFailure(res)).toBeNull()
  })

  it('delete с .select("id"): пустой массив — «нет прав на удаление»', async () => {
    const res = await clientAnswering(200, '[]').from('shower_catalog_items').delete().eq('id', 1).select('id')
    expect(writeFailure(res, 'delete')).toBe(NOT_DELETED_NO_RIGHTS)
  })
})
