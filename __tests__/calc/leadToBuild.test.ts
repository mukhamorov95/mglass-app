import { describe, it, expect } from 'vitest'
import { parseLeadConfig } from '@/lib/configurator/leadPayload'
import { leadToBuild } from '@/lib/calc/leadToBuild'

// Ш3: заявка с сайта открывается в «Расчёте» тем же составом; где сайт и «Расчёт»
// понимают поле по-разному — перевод и пометка, а не молчаливая подмена.
const base = {
  glass: { id: 'clear', label: 'Прозрачное' }, finish: { id: 'chrome', label: 'Хром' },
  choice: { hinge: 'h-1' }, qtyChoice: { hinge: 2 }, tier: 'budget', priceFrom: 50_000,
}

describe('leadToBuild', () => {
  it('М4: состав переносится как есть, пометок нет', () => {
    const o = leadToBuild(parseLeadConfig({ ...base, model: 'М4', dims: { width: 1450, height: 2000, doorWidth: 650 } })!)
    expect(o).toEqual({
      code: 'М4', dims: { width: 1450, height: 2000, doorWidth: 650 }, finishId: 'chrome', glassId: 'clear',
      choice: { hinge: 'h-1' }, qtyChoice: { hinge: 2 }, profileFrame: 'partial', priceFrom: 50_000, notes: [],
    })
  })

  it('М1: проём сайта → панель «Расчёта» (доля 0,62), другое крепление названо', () => {
    const o = leadToBuild(parseLeadConfig({ ...base, model: 'М1', dims: { width: 1000, height: 2000 }, variant: { mount: 'diag45', profileFrame: 'perimeter' } })!)
    expect(o.dims.width).toBe(620)
    expect(o.profileFrame).toBe('perimeter')
    expect(o.notes).toEqual([
      'М1: на сайте проём 1000 мм — в «Расчёте» панель 620 мм',
      'крепление штанги на сайте — диагональ 45°; «Расчёт» считает перпендикуляр к стене',
    ])
  })

  it('премиум с сайта — пометка: «Расчёт» считает бюджет', () => {
    const o = leadToBuild(parseLeadConfig({ ...base, tier: 'premium', model: 'М2', dims: { width: 900, height: 2000, doorWidth: 600 } })!)
    expect(o.notes).toEqual(['клиент смотрел премиум; «Расчёт» считает бюджетный комплект'])
  })
})
