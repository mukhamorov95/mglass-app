import { getModel } from '@/lib/configurator/arrangement'
import type { LeadConfig } from '@/lib/configurator/leadPayload'

// Заявка 3D-конструктора → поля «Расчёта» (Ш3). Чистая функция: что сайт и «Расчёт»
// понимают по-разному, переводится здесь и называется пометкой, а не теряется молча.

export type LeadOpen = {
  code: string
  dims: LeadConfig['dims']
  finishId: string
  glassId: string
  choice: Record<string, string>
  qtyChoice: Record<string, number>
  profileFrame: 'partial' | 'perimeter'
  priceFrom: number | null
  notes: string[]
}

const MOUNT_LABEL: Record<string, string> = { diag45: 'диагональ 45°', stabilizer: 'стабилизатор', ceiling: 'в потолок' }

export function leadToBuild(c: LeadConfig): LeadOpen {
  const notes: string[] = []
  const dims = { ...c.dims }
  if (c.model === 'М1') {
    // На сайте у М1 вводят проём, стекло закрывает его часть; в «Расчёте» вводят саму панель.
    const part = getModel('М1').runs.find(r => r.edge === 'front')?.part ?? 0.62
    dims.width = Math.round(c.dims.width * part)
    notes.push(`М1: на сайте проём ${c.dims.width} мм — в «Расчёте» панель ${dims.width} мм`)
    if (c.variant.mount && c.variant.mount !== 'perp90') {
      notes.push(`крепление штанги на сайте — ${MOUNT_LABEL[c.variant.mount]}; «Расчёт» считает перпендикуляр к стене`)
    }
  }
  if (c.tier === 'premium') notes.push('клиент смотрел премиум; «Расчёт» считает бюджетный комплект')
  return {
    code: c.model, dims, finishId: c.finish.id, glassId: c.glass.id,
    choice: c.choice, qtyChoice: c.qtyChoice,
    profileFrame: c.variant.profileFrame ?? 'partial',
    priceFrom: c.priceFrom, notes,
  }
}
