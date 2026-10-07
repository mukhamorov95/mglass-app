import { describe, it, expect } from 'vitest'
import { matchScore, searchByName, soundKey } from '@/lib/search/translitMatch'

const names = (q: string, list: string[]) => searchByName(list, q, s => [s]).slice(0, 3)

describe('поиск клиента в обоих алфавитах', () => {
  const clients = ['Артур', 'Shower Glass', 'M GLASS', 'СпецМонтаж', 'Arthur Design', 'Стекло-Люкс', 'Yandex Market', 'Джет Строй']

  it('пример владельца: «шо» находит Shower Glass', () => {
    expect(names('шо', clients)[0]).toBe('Shower Glass')
    expect(names('шовер', clients)[0]).toBe('Shower Glass')
  })

  it('кириллица → латиница и обратно', () => {
    expect(names('гласс', clients)).toEqual(expect.arrayContaining(['Shower Glass', 'M GLASS']))
    expect(names('арт', clients)).toEqual(['Артур', 'Arthur Design'])
    expect(names('art', clients)).toEqual(['Артур', 'Arthur Design'])
    expect(names('spets', clients)).toEqual(['СпецМонтаж'])
    expect(names('lux', clients)).toEqual(['Стекло-Люкс'])
    expect(names('яндекс', clients)).toEqual(['Yandex Market'])
    expect(names('jet', clients)).toEqual(['Джет Строй'])
  })

  it('слова и пробелы: «мглас» = «M GLASS», «монтаж» — середина слова', () => {
    expect(names('мглас', clients)).toEqual(['M GLASS'])
    expect(names('монтаж', clients)).toEqual(['СпецМонтаж'])
  })

  it('начало названия выше середины', () => {
    expect(names('гл', ['Shower Glass', 'Glass Pro'])).toEqual(['Glass Pro', 'Shower Glass'])
  })

  it('ИНН и телефон — по цифрам', () => {
    expect(matchScore('7701', ['ООО Ромашка', '7701234567'])).toBeGreaterThan(0)
    expect(matchScore('7702', ['ООО Ромашка', '7701234567'])).toBe(0)
  })

  it('юрлицо клиента тоже ищется, но название весит больше', () => {
    const list = [{ name: 'СпецМонтаж', entity: 'ИП Литвинов' }, { name: 'Литвинов Групп', entity: null }]
    expect(searchByName(list, 'литвин', c => [c.name, c.entity]).map(c => c.name)).toEqual(['Литвинов Групп', 'СпецМонтаж'])
  })

  it('пустой запрос — весь список в исходном порядке; мусор — ничего', () => {
    expect(names('', clients)).toEqual(clients.slice(0, 3))
    expect(names('зззщщщ', clients)).toEqual([])
    expect(soundKey('Ёлка Йошкар')).toBe('elka ioshkar')
  })
})
