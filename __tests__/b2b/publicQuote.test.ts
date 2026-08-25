import { describe, it, expect } from 'vitest'
import { toPublicQuote, newPublicToken } from '@/lib/b2b/publicQuote'

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
