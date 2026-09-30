import { describe, it, expect } from 'vitest'

import { leadIdFrom, canSeeLead, amoFieldValue } from '@/lib/amoLead'

describe('номер сделки AmoCRM из того, что вставил менеджер', () => {
  it('голый номер', () => expect(leadIdFrom('28123456')).toBe(28123456))
  it('номер с пробелами по краям', () => expect(leadIdFrom('  28123456 ')).toBe(28123456))
  it('ссылка на карточку сделки', () => expect(leadIdFrom('https://mglass.amocrm.ru/leads/detail/28123456')).toBe(28123456))
  it('ссылка с хвостом после номера', () => expect(leadIdFrom('https://mglass.amocrm.ru/leads/detail/28123456?tab=notes')).toBe(28123456))
  it('«№» и текст вокруг номера', () => expect(leadIdFrom('сделка №28123456')).toBe(28123456))
  it('пусто, ноль и мусор — не номер', () => {
    expect(leadIdFrom('')).toBeNull()
    expect(leadIdFrom('0')).toBeNull()
    expect(leadIdFrom('-5')).toBeNull()
    expect(leadIdFrom('abc')).toBeNull()
    expect(leadIdFrom(null)).toBeNull()
  })
})

describe('чья сделка видна менеджеру (правило 4)', () => {
  const me = { isOwner: false, canViewAll: false, amoUserId: 111 }
  it('своя — видна', () => expect(canSeeLead(me, 111)).toBe(true))
  it('чужая — не видна', () => expect(canSeeLead(me, 222)).toBe(false))
  it('не привязан к AmoCRM — не видна ни одна', () => expect(canSeeLead({ ...me, amoUserId: null }, 111)).toBe(false))
  it('«видит все сделки» — видна чужая', () => expect(canSeeLead({ ...me, canViewAll: true }, 222)).toBe(true))
  it('владелец — видна любая', () => expect(canSeeLead({ isOwner: true, canViewAll: false, amoUserId: null }, 222)).toBe(true))
})

describe('поле контакта AmoCRM', () => {
  const c = { id: 1, name: 'Иван', custom_fields_values: [{ field_code: 'PHONE', values: [{ value: ' +7 999 111-22-33 ' }] }] }
  it('телефон берётся по коду поля и обрезается', () => expect(amoFieldValue(c, 'PHONE')).toBe('+7 999 111-22-33'))
  it('нет поля — пустая строка', () => expect(amoFieldValue(c, 'EMAIL')).toBe(''))
  it('нет контакта — пустая строка', () => expect(amoFieldValue(null, 'PHONE')).toBe(''))
})
