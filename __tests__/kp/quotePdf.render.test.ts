import { describe, it, expect } from 'vitest'
import React from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import QuotePDF, { type QuotePDFProps } from '@/components/QuotePDF'

// Регрессия: серверный КП (КП-05033-LoLegko.pdf) должен рендериться и когда цену
// показываем одной суммой (consolidated, по умолчанию), и когда построчно (detailed).
const base: QuotePDFProps = {
  id: 5033,
  customNumber: '05033',
  clientOrderNumber: null,
  clientName: 'LoLegko',
  contact: null,
  phone: null,
  discountPercent: 10,
  items: [{
    materialName: 'Осветлённое',
    thickness: 6,
    width: 1978,
    height: 2425,
    quantity: 2,
    totalAreaNet: 9.593,
    saleIncVat: 88553,
    hasTempering: false,
    services: [
      { name: 'Изготовление Т и Г образных изделий', cost: 20000 },
      { name: 'Пескоструйное матирование', cost: 15000 },
      { name: 'Разработка макета в электронном виде (вектор)', cost: 5000 },
    ],
  }],
  totalSaleIncVat: 98392,
  totalAfterDiscount: 88553,
  totalArea: 9.593,
  totalWeight: 143.9,
  managerName: 'Менеджер',
  productionDays: 15,
  quoteDate: '2026-07-23',
  userNotes: null,
}

async function render(props: QuotePDFProps): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const el = React.createElement(QuotePDF, props) as any
  return renderToBuffer(el)
}

describe('QuotePDF — режимы отображения цены', () => {
  it('consolidated: рендерится в валидный PDF', async () => {
    const buf = await render({ ...base, priceMode: 'consolidated' })
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(buf.length).toBeGreaterThan(1000)
  })

  it('detailed: рендерится в валидный PDF', async () => {
    const buf = await render({ ...base, priceMode: 'detailed' })
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(buf.length).toBeGreaterThan(1000)
  })

  it('без priceMode ведёт себя как consolidated (дефолт)', async () => {
    const buf = await render(base)
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(buf.length).toBeGreaterThan(1000)
  })
})
