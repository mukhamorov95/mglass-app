import { describe, expect, it } from 'vitest'
import { parseLead } from '@/lib/configurator/leadPayload'

describe('parseLead — публичная заявка', () => {
  it('заполненное скрытое поле — бот: ничего не пишем', () => {
    expect(parseLead({ phone: '+7 900 000-00-00', website: 'spam.example' })).toEqual({ kind: 'bot' })
  })

  it('телефон короче 10 цифр — отказ', () => {
    expect(parseLead({ phone: '12345' })).toEqual({ kind: 'invalid', error: 'Нужен телефон' })
    expect(parseLead(null)).toEqual({ kind: 'invalid', error: 'Нужен телефон' })
  })

  it('старый формат 3D-виджета и Tilda: context и comment как были', () => {
    const r = parseLead({ name: 'Анна', phone: '89001234567', comment: 'душевая в нишу', context: 'shower-embed' })
    expect(r.kind).toBe('ok')
    if (r.kind !== 'ok') return
    expect(r.row).toEqual({ name: 'Анна', phone: '89001234567', comment: 'душевая в нишу', context: 'shower-embed', source: 'site' })
  })

  it('сайт зеркал: изделие, размеры и метки не теряются', () => {
    const r = parseLead({
      phone: '+7 (900) 123-45-67',
      product: 'Зеркала с подсветкой на заказ',
      sizes: '800 × 600 мм',
      comment: 'аура, сенсор',
      page: 'https://zerkala.example/zerkala-s-podsvetkoj',
      source: 'site-zerkala',
      utm: { utm_source: 'yandex', utm_medium: 'cpc', evil: 'x' },
      consent: true,
    })
    expect(r.kind).toBe('ok')
    if (r.kind !== 'ok') return
    expect(r.row.source).toBe('site-zerkala')
    expect(r.row.context).toBe('https://zerkala.example/zerkala-s-podsvetkoj')
    expect(r.row.comment).toBe('Изделие: Зеркала с подсветкой на заказ\nРазмеры: 800 × 600 мм\nаура, сенсор\nМетки: utm_source=yandex, utm_medium=cpc')
    expect(r.message).toContain('Размеры: 800 × 600 мм')
    expect(r.message).not.toContain('evil')
  })

  it('длинные поля обрезаются', () => {
    const r = parseLead({ phone: '9001234567', name: 'а'.repeat(500), page: 'x'.repeat(1000) })
    if (r.kind !== 'ok') throw new Error(r.kind)
    expect(r.row.name).toHaveLength(120)
    expect(r.row.context).toHaveLength(300)
  })
})
