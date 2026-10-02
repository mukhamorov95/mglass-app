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

// Ш3: заявка 3D-конструктора несёт состав, по которому менеджер откроет тот же расчёт.
describe('parseLead — состав из 3D-конструктора', () => {
  const config = {
    model: 'М7', name: 'Угловая распашная', dims: { width: 1200, width2: 900, height: 2000, doorWidth: 600 }, thickness: 8, tier: 'budget',
    glass: { id: 'clear', label: 'Прозрачное М1' }, finish: { id: 'black', label: 'Чёрный матовый' },
    glassAreaM2: 4.2, sections: 2,
    choice: { hinge: 'abc-123', 'Bad Role': 'x' }, qtyChoice: { hinge: 3, handle: 99 },
    variant: { mount: 'perp90', glassSpan: 'opening' },
    priceFrom: 74100,
  }

  it('берёт только белый список: модель, размеры, стекло, цвет, выбор, цену «от»', () => {
    const r = parseLead({ name: 'Анна', phone: '+7 900 123-45-67', source: 'configurator-3d', config })
    expect(r.kind).toBe('ok')
    if (r.kind !== 'ok') return
    expect(r.config).toEqual({
      model: 'М7', name: 'Угловая распашная', dims: { width: 1200, width2: 900, height: 2000, doorWidth: 600 }, tier: 'budget',
      glass: { id: 'clear', label: 'Прозрачное М1' }, finish: { id: 'black', label: 'Чёрный матовый' },
      choice: { hinge: 'abc-123' }, qtyChoice: { hinge: 3 }, variant: { mount: 'perp90' }, priceFrom: 74100,
    })
    expect(r.message).toContain('Душевая: М7 Угловая распашная · 1200×900×2000 мм · Прозрачное М1 · Чёрный матовый · видел «от 74 100 ₽»')
    expect(r.row.comment).toContain('Конструктор: М7')
    expect(r.row.source).toBe('configurator-3d')
  })

  it('неизвестная модель или размер вне границ — заявка принимается, состава нет', () => {
    const bad = parseLead({ phone: '89001234567', config: { ...config, model: 'М99' } })
    expect(bad.kind === 'ok' && bad.config).toBe(null)
    const tiny = parseLead({ phone: '89001234567', config: { ...config, dims: { width: 5, height: 2000 } } })
    expect(tiny.kind === 'ok' && tiny.config).toBe(null)
    const plain = parseLead({ phone: '89001234567' })
    expect(plain.kind === 'ok' && plain.config).toBe(null)
  })

  it('«&» и «<» клиента экранируются: Telegram читает сообщение как HTML', () => {
    const r = parseLead({ name: 'Ан<на>', phone: '89001234567', comment: 'душевая & зеркало' })
    expect(r.kind === 'ok' && r.message).toContain('Имя: Ан&lt;на&gt;')
    expect(r.kind === 'ok' && r.message).toContain('душевая &amp; зеркало')
    expect(r.kind === 'ok' && r.row.comment).toBe('душевая & зеркало')
  })
})
