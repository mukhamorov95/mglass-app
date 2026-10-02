import { describe, it, expect } from 'vitest'
import {
  normalizeInquiryInput, hasWho, statusPatch, isInquiryStatus, inquiryTitle,
  minutesBetween, durationLabel, isOverdue,
} from '@/lib/b2b/inquiries'

describe('ввод заявки', () => {
  it('обрезает пробелы и длину, пустое — null', () => {
    const r = normalizeInquiryInput({ contact_name: '  Иван   Петров ', company: '   ', phone: '+7 999 123-45-67' })
    expect(r).toEqual({ ok: true, value: { contact_name: 'Иван Петров', company: null, phone: '+7 999 123-45-67' } })
  })
  it('запрос клиента сохраняет переводы строк — это список размеров', () => {
    const r = normalizeInquiryInput({ request: ' 600×800 — 2 шт\n500×700 — 1 шт ' })
    expect(r.ok && r.value.request).toBe('600×800 — 2 шт\n500×700 — 1 шт')
  })
  it('ссылка на чат — только https', () => {
    expect(normalizeInquiryInput({ chat_url: 'https://www.avito.ru/profile/messenger/channel/u2i-1' }).ok).toBe(true)
    expect(normalizeInquiryInput({ chat_url: 'javascript:alert(1)' })).toEqual({ ok: false, error: 'Ссылка на чат — полный адрес https://…' })
    expect(normalizeInquiryInput({ chat_url: 'http://avito.ru/x' }).ok).toBe(false)
  })
  it('источник — только из списка', () => {
    expect(normalizeInquiryInput({ source: 'avito' })).toEqual({ ok: true, value: { source: 'avito' } })
    expect(normalizeInquiryInput({ source: 'spam' }).ok).toBe(false)
  })
  it('без кого-нибудь, кому ответить, заявки нет', () => {
    expect(hasWho({})).toBe(false)
    expect(hasWho({ phone: '+79991234567' })).toBe(true)
  })
})

describe('статусы', () => {
  const now = '2026-10-02T10:30:00Z'
  it('первый ответ ставится один раз', () => {
    expect(statusPatch({ status: 'new', answered_at: null }, 'answered', now)).toMatchObject({ status: 'answered', answered_at: now, closed_at: null })
    const later = statusPatch({ status: 'answered', answered_at: '2026-10-02T10:05:00Z' }, 'quoted', now)
    expect(later).not.toHaveProperty('answered_at')
  })
  it('сразу в заказ — тоже ответ, и заявка закрыта', () =>
    expect(statusPatch({ status: 'new', answered_at: null }, 'won', now)).toMatchObject({ answered_at: now, closed_at: now }))
  it('причина отказа живёт только у отказа', () => {
    expect(statusPatch({ status: 'quoted', answered_at: now }, 'lost', now, 'дорого')).toMatchObject({ lost_reason: 'дорого', closed_at: now })
    expect(statusPatch({ status: 'lost', answered_at: now }, 'answered', now)).toMatchObject({ lost_reason: null, closed_at: null })
  })
  it('возврат в «новую» не стирает время ответа', () =>
    expect(statusPatch({ status: 'answered', answered_at: now }, 'new', now)).not.toHaveProperty('answered_at'))
  it('чужой статус отвергается', () => {
    expect(isInquiryStatus('won')).toBe(true)
    expect(isInquiryStatus('done')).toBe(false)
  })
})

describe('время', () => {
  it('подписи длительности', () => {
    expect(durationLabel(12)).toBe('12 мин')
    expect(durationLabel(60)).toBe('1 ч')
    expect(durationLabel(185)).toBe('3 ч 5 мин')
    expect(durationLabel(3 * 24 * 60 + 5)).toBe('3 дн')
  })
  it('просрочена только новая заявка старше 30 минут', () => {
    const now = '2026-10-02T10:31:00Z'
    expect(isOverdue({ status: 'new', created_at: '2026-10-02T10:00:00Z' }, now)).toBe(true)
    expect(isOverdue({ status: 'new', created_at: '2026-10-02T10:01:00Z' }, now)).toBe(false)
    expect(isOverdue({ status: 'answered', created_at: '2026-10-01T10:00:00Z' }, now)).toBe(false)
  })
  it('отрицательной длительности не бывает', () => expect(minutesBetween('2026-10-02T10:00:00Z', '2026-10-02T09:00:00Z')).toBe(0))
  it('название заявки — компания, человек, телефон или номер', () => {
    expect(inquiryTitle({ id: 5, company: null, contact_name: null, phone: null })).toBe('Заявка №5')
    expect(inquiryTitle({ id: 5, company: 'ООО Мебель', contact_name: 'Иван', phone: null })).toBe('ООО Мебель')
  })
})
