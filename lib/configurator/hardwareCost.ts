import 'server-only'
import { getModel, M_MODELS } from '@/lib/configurator/arrangement'
import { computeKitQuantities, computeKitPrice } from '@/lib/configurator/kit'
import { buildWithVariant } from '@/lib/configurator/quoteContract'
import { resolveTierData } from '@/lib/configurator/priceVersion'
import { configuratorCode } from '@/lib/configurator/legacyModelMap'
import { FINISH_IDS } from '@/lib/configurator/pricing'

// ЕДИНСТВЕННЫЙ источник себестоимости фурнитуры душевой — прайс визуализатора
// (/admin/visualizer-pricing → configurator_pricing + библиотека комплектов).
// Всё остальное — флэт hardware_base × коэффициент, ручная таблица
// shower_budget_manual_prices — занижало на 20–99% и считается неправдой.
// Здесь один вход, чтобы у калькуляторов не было соблазна завести второй.

export type HardwareCostResult = {
  cost: number                 // ₽ закупки фурнитуры по составу комплекта
  complete: boolean            // весь ли комплект имеет цену
  missing: string[]            // чего не хватило в прайсе
  sections: number
  modelCode: string            // код модели в конфигураторе (кириллица)
}

// Цвет фурнитуры легаси-калькулятора → finishId прайса визуализатора.
// Совпадающие имена берём как есть; чего в прайсе нет — считаем хромом,
// потому что база цен заведена по хрому, а не потому что цвет неважен.
export function finishFromLegacyColor(color?: string): string {
  const v = (color ?? '').trim()
  return (FINISH_IDS as readonly string[]).includes(v) ? v : 'chrome'
}

export async function hardwareCostFromVisualizer(opts: {
  modelId: string              // легаси-id: M1…M12
  width: number                // мм
  height: number               // мм
  width2?: number              // мм, вторая сторона у угловых
  thickness?: number
  hardwareColor?: string
}): Promise<HardwareCostResult | null> {
  const code = configuratorCode(opts.modelId)
  if (!code || !M_MODELS.some(m => m.code === code)) return null

  const thickness = opts.thickness ?? 8
  const model = getModel(code)
  const { data: { library, rates, kits }, finance } = await resolveTierData('budget')

  const assembly = buildWithVariant(
    model,
    { width: opts.width, height: opts.height, width2: opts.width2 ?? opts.width },
    thickness,
  )
  const q = computeKitQuantities(assembly, thickness, model, rates.capMargin)
  const price = computeKitPrice(q, library, kits[code] ?? { slots: [] }, rates, finance, {
    finishId: finishFromLegacyColor(opts.hardwareColor),
  })

  return {
    cost: Math.round(price.hardwareCost),
    complete: price.missing.length === 0,
    missing: price.missing.map(m => `${m.label}: ${m.reason}`),
    sections: price.sections,
    modelCode: code,
  }
}
