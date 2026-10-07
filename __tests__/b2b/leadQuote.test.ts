import { describe, it, expect } from 'vitest'
import {
  LEAD_REPLY_TEMPLATES, buildClientQuoteText, clientQuoteTextFromOrder, leadNoteError, leadNotesPatch, noClientName,
  noClientSaveBlocker, quoteLeadChips, readQuoteLead,
} from '@/lib/b2b/leadQuote'
import type { InvoiceOrder } from '@/lib/b2b/invoiceMath'

const tinted = { materialName: 'Тонированное (бронза/графит)', thickness: 4, width: 480, height: 1835, quantity: 1, hasTempering: true, saleIncVat: 3000 }

describe('просчёт без заказчика: откуда и кто', () => {
  it('две независимые отметки читаются из notes; мусор отбрасывается', () => {
    expect(readQuoteLead({ lead_source: 'avito', customer_kind: 'wholesale', lead_contact: ' Дмитрий ' }))
      .toEqual({ source: 'avito', kind: 'wholesale', contact: 'Дмитрий' })
    expect(readQuoteLead({ lead_source: 'telegram-spam', customer_kind: 'vip' })).toEqual({ source: null, kind: null, contact: null })
  })

  it('без отметок «откуда» и «кто» без заказчика не сохранить', () => {
    expect(noClientSaveBlocker({ source: null, kind: 'retail', contact: null })).toBe('Откуда пришёл?')
    expect(noClientSaveBlocker({ source: 'avito', kind: null, contact: null })).toBe('Розница или опт?')
    expect(noClientSaveBlocker({ source: 'avito', kind: 'retail', contact: null })).toBeNull()
  })

  it('сервер принимает только известные значения', () => {
    expect(leadNoteError('lead_source', 'avito')).toBeNull()
    expect(leadNoteError('lead_source', 'x')).not.toBeNull()
    expect(leadNoteError('customer_kind', 'retail')).toBeNull()
    expect(leadNoteError('customer_kind', 'vip')).not.toBeNull()
    expect(leadNoteError('lead_contact', 'x'.repeat(121))).not.toBeNull()
    expect(leadNoteError('lead_source', null)).toBeNull()
    expect(leadNotesPatch({ source: 'avito', kind: 'retail', contact: null })).toEqual({ lead_source: 'avito', customer_kind: 'retail', lead_contact: null })
  })

  it('имя в списке и метки строки', () => {
    expect(noClientName('Дмитрий')).toBe('Дмитрий')
    expect(noClientName(null)).toBe('Без заказчика')
    expect(quoteLeadChips({ source: 'avito', kind: 'retail', contact: 'Дмитрий' }, false)).toEqual(['Авито', 'розница', 'без заказчика'])
    expect(quoteLeadChips({ source: 'avito', kind: 'wholesale', contact: null }, true)).toEqual(['Авито', 'опт'])
  })
})

describe('текст ответа клиенту', () => {
  it('одна позиция — как в чате Авито: что, размер, цена, срок, где забрать', () => {
    const t = buildClientQuoteText({ items: [tinted], lineTotals: [3000], total: 3000, productionDays: 7, contact: 'Дмитрий, Авито', kind: 'retail' })
    expect(t).toBe([
      'Здравствуйте, Дмитрий!',
      'Посчитали ваш заказ:',
      '',
      `Тонированное (бронза/графит) 4 мм, закалённое — 480×1835 мм, 1 шт. — ${(3000).toLocaleString('ru-RU')} ₽`,
      '',
      `Итого: ${(3000).toLocaleString('ru-RU')} ₽`,
      'Срок изготовления — 7 рабочих дней.',
      'Забрать можно в Мытищах, доставка — по договорённости.',
      'Если всё подходит — напишите, оформим заказ.',
    ].join('\n'))
  })

  it('опт — итог с НДС, позиции нумеруются; платные услуги в названии, бесплатные нет', () => {
    const t = buildClientQuoteText({
      items: [{ ...tinted, services: [{ name: 'Шлифовка кромки', cost: 300 }, { name: 'Упаковка', cost: 0 }] }, { materialName: 'Зеркало серебро', thickness: 4, width: 600, height: 600, quantity: 2 }],
      lineTotals: [3300, 1999.5], total: 5299.5, productionDays: 3, contact: null, kind: 'wholesale',
    })
    expect(t.startsWith('Здравствуйте!\n')).toBe(true)
    expect(t).toContain('1. Тонированное (бронза/графит) 4 мм, закалённое, шлифовка кромки — 480×1835 мм, 1 шт.')
    expect(t).not.toContain('упаковка')
    expect(t).toContain('2. Зеркало серебро 4 мм — 600×600 мм, 2 шт.')
    expect(t).toContain(' с НДС')
    expect(t).toContain('Срок изготовления — 3 рабочих дня.')
  })

  it('в тексте нет себестоимости и внутренних полей', () => {
    const order = {
      id: 1, custom_number: null, discount_percent: 0, created_at: '2026-10-07T10:00:00Z',
      notes: JSON.stringify({ production_days: 7, lead_source: 'avito', customer_kind: 'retail', lead_contact: 'Дмитрий' }),
      total_sale_inc_vat: 3000, total_after_discount: 3000,
      items: [{ ...tinted, costExVat: 1170, margin: 52 }],
    } as unknown as InvoiceOrder
    const t = clientQuoteTextFromOrder(order, JSON.parse(order.notes!))
    expect(t).toContain('Здравствуйте, Дмитрий!')
    expect(t).not.toMatch(/1\s?170|52|маржа|себестоим/i)
  })
})

describe('LEAD_REPLY_TEMPLATES — ответы вдогонку к расчёту', () => {
  it('два шаблона: партнёрство и вопрос об оплате', () => {
    expect(LEAD_REPLY_TEMPLATES.map(t => t.key)).toEqual(['partner', 'payment'])
  })
  it('без приветствия и без внутреннего: себестоимости, маржи, сумм', () => {
    for (const t of LEAD_REPLY_TEMPLATES) {
      expect(t.text).not.toMatch(/^Здравствуйте/)
      expect(t.text).not.toMatch(/себестоим|марж|₽/i)
    }
  })
  it('партнёрство просит назвать цену, оплата — спрашивает форму оплаты', () => {
    expect(LEAD_REPLY_TEMPLATES[0].text).toMatch(/Назовите цену/)
    expect(LEAD_REPLY_TEMPLATES[1].text).toMatch(/как вам удобнее оплатить/)
  })
})
