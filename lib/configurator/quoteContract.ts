import type { MModel } from '@/lib/configurator/arrangement'
import type { Assembly, MDims } from '@/components/configurator/scene/assembly'
import { buildFromModel } from '@/components/configurator/scene/assembly'
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
  variant?: Record<string, string>          // ключи геометрии (mount, profileFrame…) — прайс их не трактует
  choice?: Partial<Record<RoleId, string>>  // выбранная позиция в роли
  qtyChoice?: Partial<Record<RoleId, number>> // выбранное количество (петель 2 или 3)
}

export type OptionsResponse = KitChoices          // что предложить клиенту: варианты и количества
export type QuoteFull = { full: true; price: KitPriceResult }
export type QuotePublic = { full: false; total: number; clientFrom: number; complete: boolean }
export type QuoteResponse = QuoteFull | QuotePublic

// Вариант приходит от геометрии и уходит в геометрию — прайс его только передаёт.
// Пока билдер не принимает variant, лишний аргумент игнорируется; когда примет —
// адаптер исчезнет вместе с этим комментарием.
type Builder = (model: MModel, dims: MDims, thickness: number, doorOpen?: boolean, choice?: unknown, variant?: Record<string, string>) => Assembly
export function buildWithVariant(model: MModel, dims: MDims, thickness: number, variant?: Record<string, string>): Assembly {
  return (buildFromModel as Builder)(model, dims, thickness, undefined, undefined, variant)
}
