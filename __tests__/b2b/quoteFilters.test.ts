import { describe, it, expect } from 'vitest'
import { quoteAuthor, quoteSource, matchesFilter, filterFacets, readFilterFromUrl, filterToSearch } from '@/lib/b2b/quoteFilters'

const n = (o: Record<string, unknown>) => JSON.stringify(o)
const clients = new Map<number, string>([[7, 'partner_program'], [8, 'avito']])
const Q = [
  { id: 1, created_by_name: 'Нуржан', notes: n({ lead_source: 'avito' }), client_id: null },
  { id: 2, created_by_name: 'Нуржан', notes: null, client_id: 7 },
  { id: 3, created_by_name: null, notes: n({ manager_name: 'Вера' }), client_id: 8 },
  { id: 4, created_by_name: 'Вера', notes: n({ lead_source: 'nonsense' }), client_id: null },
]

describe('Фильтры B2B-просчётов', () => {
  it('автор — как в строке «Просчитал»: колонка, иначе manager_name из notes', () => {
    expect(Q.map(quoteAuthor)).toEqual(['Нуржан', 'Нуржан', 'Вера', 'Вера'])
  })

  it('откуда — из просчёта, иначе из карточки заказчика; чужое значение не источник', () => {
    expect(Q.map(q => quoteSource(q, clients))).toEqual(['avito', 'partner_program', 'avito', null])
  })

  it('Авито одной кнопкой — и без заказчика, и с заказчиком из Авито', () => {
    expect(Q.filter(q => matchesFilter(q, { by: null, src: 'avito' }, clients)).map(q => q.id)).toEqual([1, 3])
    expect(Q.filter(q => matchesFilter(q, { by: 'Вера', src: 'avito' }, clients)).map(q => q.id)).toEqual([3])
  })

  it('число на кнопке — сколько останется, если нажать; Авито первым', () => {
    const f = filterFacets(Q, { by: 'Нуржан', src: null }, clients)
    expect(f.sources).toEqual([['avito', 1], ['partner_program', 1]])
    expect(f.authors).toEqual([['Вера', 2], ['Нуржан', 2]])
  })

  it('выбранное без совпадений в вкладке остаётся кнопкой с нулём', () => {
    const f = filterFacets([Q[1]], { by: 'Вера', src: 'avito' }, clients)
    expect(f.authors).toContainEqual(['Вера', 0])
    expect(f.sources).toContainEqual(['avito', 0])
  })

  it('выбор живёт в адресе и не трогает чужие параметры', () => {
    expect(readFilterFromUrl('?by=%D0%92%D0%B5%D1%80%D0%B0&src=avito')).toEqual({ by: 'Вера', src: 'avito' })
    expect(filterToSearch('?x=1', { by: null, src: 'avito' })).toBe('?x=1&src=avito')
    expect(filterToSearch('?src=avito', { by: null, src: null })).toBe('')
  })
})
