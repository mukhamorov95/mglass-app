import type { MModel } from '@/lib/configurator/arrangement'
import { buildFromModel, type Assembly, type MDims, type MVariant } from '@/components/configurator/scene/assembly'
import type { RoleId, KitChoices, KitPriceResult } from '@/lib/configurator/kit'

// Контракт между визуализатором (геометрия, 3D, UI) и прайсом. Клиент присылает выбор,
// сервер отвечает ценой — себестоимость и ставки в браузер не уходят.

export type QuoteRequest = {
  model: string
  dims: MDims
  thickness?: number
  tier?: 'budget' | 'premium'
  glassType?: string
  finishId?: string
  withDelivery?: boolean
  floors?: number
  variant?: MVariant                        // ключи геометрии (mount, profileFrame) — прайс их не трактует
  choice?: Partial<Record<RoleId, string>>  // выбранная позиция в роли
  qtyChoice?: Partial<Record<RoleId, number>> // выбранное количество (петель 2 или 3)
}

export type OptionsResponse = KitChoices          // что предложить клиенту: варианты и количества
export type QuoteFull = { full: true; price: KitPriceResult }
export type QuotePublic = { full: false; total: number; clientFrom: number; complete: boolean }
export type QuoteResponse = QuoteFull | QuotePublic

// Вариант приходит от геометрии и уходит в геометрию — прайс его только передаёт.
// dims несёт trayDepth/ceilingHeight и уходит в геометрию как есть: длину куска трубы
// (глубина поддона) считает она, цену и раскрой — прайс.
export function buildWithVariant(model: MModel, dims: MDims, thickness: number, variant?: MVariant): Assembly {
  return buildFromModel(model, dims, thickness, true, {}, variant ?? {})
}
