import { describe, it, expect } from 'vitest'
import { toPublicQuote, newPublicToken, documentSafeOrder, documentSafeItems, documentSafeNotes } from '@/lib/b2b/publicQuote'

// Публичное КП отдаётся без логина — главное требование: наружу не уходит
// ничего про себестоимость и внутреннюю кухню.

const ORDER = {
  id: 5322,
  client_name: 'Артур',
  custom_number: null,
  discount_percent: 10,
  items: [{
    materialName: 'Зеркало 4 мм', thickness: 4, width: 600, height: 800, quantity: 2,
    saleIncVat: 38008, manualTotal: null, hasTempering: true, costExVat: 16616,
    costMaterial: 9000, margin: 56, inputVat: 3323, pricePerM2: 4200,
    services: [{ id: 1, name: 'Полировка', cost: 800 }],
  }],
  total_area: 0.96, total_weight: 8.5,
  total_sale_inc_vat: 38008, total_after_discount: 34207,
  notes: JSON.stringify({ status: 'quote', manager_name: 'Нуржан', production_days: 5, kp_payment_terms: '100' }),
  created_at: '2026-08-25T08:51:00.000Z',
}

describe('toPublicQuote', () => {
  it('не отдаёт себестоимость и маржу', () => {
    const pub = toPublicQuote(ORDER)
    const json = JSON.stringify(pub)
    for (const leak of ['costExVat', 'costMaterial', 'inputVat', 'margin', 'pricePerM2', '16616', '9000']) {
      expect(json).not.toContain(leak)
    }
    // цена услуги — тоже внутренняя кухня, наружу только название
    expect(pub.items[0].services?.[0]).toEqual({ id: 1, name: 'Полировка' })
  })

  it('отдаёт то, что клиент и так видит в КП', () => {
    const pub = toPublicQuote(ORDER)
    expect(pub.number).toBe('05322')
    expect(pub.clientName).toBe('Артур')
    expect(pub.totalFinal).toBe(34207)
    expect(pub.discountPercent).toBe(10)
    expect(pub.productionDays).toBe(5)
    expect(pub.paymentTerms).toBe('100')
    expect(pub.managerName).toBe('Нуржан')
    expect(pub.items[0].width).toBe(600)
  })

  it('запущенный заказ показывается как launched, отказ — как rejected', () => {
    const launched = toPublicQuote({ ...ORDER, notes: JSON.stringify({ status: 'confirmed' }) })
    expect(launched.status).toBe('launched')
    const rejected = toPublicQuote({ ...ORDER, notes: JSON.stringify({ status: 'rejected' }) })
    expect(rejected.status).toBe('rejected')
  })

  it('срок действия — 14 дней от даты просчёта', () => {
    const pub = toPublicQuote(ORDER)
    const days = (new Date(pub.validUntil).getTime() - new Date(pub.quoteDate).getTime()) / 86_400_000
    expect(Math.round(days)).toBe(14)
  })

  it('токен — 32 hex-символа и не повторяется', () => {
    const a = newPublicToken(), b = newPublicToken()
    expect(a).toMatch(/^[a-f0-9]{32}$/)
    expect(a).not.toBe(b)
  })
})

// Кабинет партнёра: счёт и УПД получают заказ через documentSafeOrder — сырой items
// содержит costExVat/costMaterial/margin и цены услуг, наружу они уходить не должны.
describe('documentSafeOrder — кабинет партнёра', () => {
  const LEAKS = ['costExVat', 'costMaterial', 'costWithVat', 'inputVat', 'margin', 'pricePerM2', 'totalAreaBilled', 'wastePercent']

  it('не отдаёт себестоимость и внутренние поля позиции', () => {
    const safe = documentSafeOrder({ ...ORDER, launched_at: '2026-08-25T00:00:00Z' })
    const json = JSON.stringify(safe)
    for (const leak of LEAKS) expect(json).not.toContain(leak)
    expect(json).not.toContain('16616')
  })

  it('оставляет всё, что печатается в счёте', () => {
    const safe = documentSafeOrder({ ...ORDER, launched_at: null })
    expect(safe.total_after_discount).toBe(34207)
    expect(safe.discount_percent).toBe(10)
    expect(safe.items[0].saleIncVat).toBe(38008)
    expect(safe.items[0].materialName).toBe('Зеркало 4 мм')
    expect(safe.items[0].quantity).toBe(2)
  })

  it('цена услуги внутрь строки не попадает', () => {
    const [it] = documentSafeItems(ORDER.items)
    expect(it.services).toEqual([{ id: 1, name: 'Полировка' }])
    expect(JSON.stringify(it.services)).not.toContain('cost')
  })

  it('мусор вместо items не роняет документ', () => {
    expect(documentSafeItems(null)).toEqual([])
    expect(documentSafeItems('нет')).toEqual([])
  })
})

// Дыра, прожившая до аудита безопасности: documentSafeOrder резал cost из items,
// но notes отдавал сырыми — через них наружу уходили ai_review, status_history,
// status_comment. Тест раньше проверял только items и давал ложное покрытие.
describe('documentSafeOrder / documentSafeNotes — очистка notes', () => {
  const DIRTY = JSON.stringify({
    quote_date: '2026-08-25', production_days: 5, shipped_date: '2026-08-30', launched_at: '2026-08-26',
    // внутреннее — наружу идти НЕ должно:
    ai_review: { issues: [{ severity: 'high', text: 'маржа тонкая' }], summary: 'риск' },
    status_history: [{ from: 'quote', to: 'agreed', by: 'client_link' }],
    status_comment: 'внутренняя пометка менеджера',
    price_approval: { needed: true, margin: 12 },
    manager_name: 'Нуржан', payment_status: 'partial', price_override: { base: 40000 },
  })

  it('оставляет только печатаемые в документах поля notes', () => {
    const safe = documentSafeOrder({ ...ORDER, notes: DIRTY })
    const parsed = JSON.parse(safe.notes as string)
    expect(Object.keys(parsed).sort()).toEqual(['launched_at', 'production_days', 'quote_date', 'shipped_date'])
  })

  it('внутренние поля не просачиваются даже подстрокой', () => {
    const safe = documentSafeOrder({ ...ORDER, notes: DIRTY })
    const json = JSON.stringify(safe)
    for (const leak of ['ai_review', 'status_history', 'status_comment', 'price_approval', 'price_override', 'payment_status', 'manager_name', 'маржа тонкая', 'внутренняя пометка']) {
      expect(json).not.toContain(leak)
    }
  })

  it('УПД снова получает shipped_date/launched_at (регресс локального фикса #299)', () => {
    const notes = documentSafeNotes(DIRTY)
    const parsed = JSON.parse(notes as string)
    expect(parsed.shipped_date).toBe('2026-08-30')
    expect(parsed.launched_at).toBe('2026-08-26')
  })

  it('пустые/мусорные notes дают null, а не «{}»', () => {
    expect(documentSafeNotes(null)).toBeNull()
    expect(documentSafeNotes('не json')).toBeNull()
    expect(documentSafeNotes(JSON.stringify({ status_comment: 'только внутреннее' }))).toBeNull()
  })
})
