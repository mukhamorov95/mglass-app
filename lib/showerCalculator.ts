import type { FinancialSettings, Service } from './types'

export type ShowerModelId =
  'M1'|'M2'|'M3'|'M4'|'M5'|'M6'|'M7'|'M8'|
  'M9'|'M10'|'M11'|'M12'

export type DimType = 'single' | 'corner'
export type ShowerTier = 'budget' | 'standard'

export type ShowerHardwareType = 'stationary' | 'swing' | 'sliding'

export type ShowerHardwareLine = {
  name: string
  qty: number
  unit: string
  color: string
  unitCost: number
  total: number
}

export type ShowerModel = {
  id: ShowerModelId
  label: string
  desc: string
  glassCount: number
  dimType: DimType
  hardwareBase: number
  hardwareType: ShowerHardwareType
  image_url?: string
}

// Картинки моделей: по умолчанию единая SVG-иллюстрация (components/ShowerModelIcon),
// либо загруженное в админке фото (/admin/shower-images → shower_model_images).
// Статические image_url убраны — файлов почти не было (битые заглушки → «стрёмно»).
export const SHOWER_MODELS: ShowerModel[] = [
  { id: 'M1',  label: 'М1',  desc: 'Стационарная панель',             glassCount: 1, dimType: 'single', hardwareBase: 4000,  hardwareType: 'stationary' },
  { id: 'M2',  label: 'М2',  desc: 'Неподвижное + распашная дверь',   glassCount: 2, dimType: 'single', hardwareBase: 13000, hardwareType: 'swing'      },
  { id: 'M3',  label: 'М3',  desc: 'Распашная дверь + неподвижное',   glassCount: 2, dimType: 'single', hardwareBase: 13000, hardwareType: 'swing'      },
  { id: 'M4',  label: 'М4',  desc: '2 неподвижных + распашная дверь', glassCount: 3, dimType: 'corner', hardwareBase: 17000, hardwareType: 'swing'      },
  { id: 'M5',  label: 'М5',  desc: 'Только распашная дверь',          glassCount: 1, dimType: 'single', hardwareBase: 9000,  hardwareType: 'swing'      },
  { id: 'M6',  label: 'М6',  desc: 'Угловая: панель + дверь',         glassCount: 2, dimType: 'corner', hardwareBase: 15000, hardwareType: 'swing'      },
  { id: 'M7',  label: 'М7',  desc: 'Угловая: 2 панели + дверь',       glassCount: 3, dimType: 'corner', hardwareBase: 18000, hardwareType: 'swing'      },
  { id: 'M8',  label: 'М8',  desc: 'Угловая: 2 раздвижных двери',     glassCount: 4, dimType: 'corner', hardwareBase: 22000, hardwareType: 'sliding'    },
  { id: 'M9',  label: 'М9',  desc: 'Угловая: раздвижная + 2 панели',  glassCount: 3, dimType: 'corner', hardwareBase: 17000, hardwareType: 'sliding'    },
  { id: 'M10', label: 'М10', desc: 'Раздвижная прямая',               glassCount: 2, dimType: 'single', hardwareBase: 12000, hardwareType: 'sliding'    },
  { id: 'M11', label: 'М11', desc: 'Трапециевидная с дверью',         glassCount: 2, dimType: 'single', hardwareBase: 14000, hardwareType: 'swing'      },
  { id: 'M12', label: 'М12', desc: 'Раздвижная (вариант)',            glassCount: 2, dimType: 'single', hardwareBase: 12000, hardwareType: 'sliding'    },
]

export type TierConfig = {
  value: ShowerTier
  label: string
  subtitle: string
  hwDesc: string          // описание фурнитуры
  hwMultiplier: number    // коэффициент к hardwareBase
  expensesPercent: number // процент расходов
  colors: string[]        // доступные цвета
}

export const TIER_CONFIGS: TierConfig[] = [
  {
    value: 'budget',
    label: 'Бюджетная',
    subtitle: 'Алюминий + нержавейка',
    hwDesc: 'Алюминиевый профиль, фурнитура нержавейка',
    hwMultiplier: 0.60,
    expensesPercent: 33,
    colors: ['chrome', 'black', 'white'],
  },
  {
    value: 'standard',
    label: 'Стандарт',
    subtitle: 'Алюминий + латунь',
    hwDesc: 'Алюминиевый профиль, метлы латунь',
    hwMultiplier: 1.00,
    expensesPercent: 39,
    colors: ['chrome', 'black', 'bronze', 'gold', 'white'],
  },
]

export const HARDWARE_COLORS: { value: string; label: string; multiplier: number }[] = [
  { value: 'chrome',  label: 'Хром',   multiplier: 1.00 },
  { value: 'black',   label: 'Чёрный', multiplier: 1.25 },
  { value: 'bronze',  label: 'Бронза', multiplier: 1.30 },
  { value: 'gold',    label: 'Золото', multiplier: 1.45 },
  { value: 'white',   label: 'Белый',  multiplier: 1.15 },
]

export type ShowerInputs = {
  tier: ShowerTier
  model: ShowerModel
  width: number
  width2: number
  height: number
  glassCostPerM2: number
  glassName: string
  thickness: 8 | 10
  hardwareColor: string
  hardwareColorMultiplier: number
  withMounting: boolean
  withDelivery: boolean
  deliveryCost?: number   // когда задан — используется вместо поиска услуги (линейная доставка за МКАД)
  kmFromMkad?: number     // км за МКАД, только для текста КП
  floors: number
  discount: number
  partnerPercent: number
  margin: number
  expensesPercent: number  // from tier
  hwTierMultiplier: number // from tier
  customHardwareCost?: number         // when using catalog builder
  customHardwareLines?: ShowerHardwareLine[]
  minMargin?: number      // floor for belowMinMargin flag, default 25
  standardMargin?: number // base margin for manager upsell bonus, default = margin
}

export type CostLine    = { name: string; qty: number; unit: string; price: number; total: number }
export type ServiceLine = { name: string; qty: number; unit: string; price: number; total: number }

export type ShowerResult = {
  glassArea: number
  glassCost: number
  hardwareCost: number
  totalCost: number
  expensesPercent: number
  expensesAmount: number
  basePrice: number
  partnerAmount: number
  priceWithPartner: number
  discountAmount: number
  finalPrice: number
  serviceLines: ServiceLine[]
  servicesTotal: number
  grandTotal: number
  margin: number
  profit: number
  managerBaseCommission: number
  managerUpsellBonus: number
  managerBonus: number
  belowMinMargin: boolean
  clientText: string
  costLines: CostLine[]
}

export function calculateShower(
  inputs: ShowerInputs,
  services: Service[],
): ShowerResult {
  const {
    model, width, width2, height, glassCostPerM2, hardwareColorMultiplier,
    hwTierMultiplier, expensesPercent,
    withMounting, withDelivery, floors, discount, partnerPercent, margin,
  } = inputs

  // Площадь стекла
  const glassArea = model.dimType === 'corner'
    ? ((width + width2) * height) / 1_000_000
    : (width * height) / 1_000_000

  // Себестоимость
  const glassCost    = Math.round(glassCostPerM2 * glassArea)
  const hardwareCost = inputs.customHardwareCost !== undefined
    ? inputs.customHardwareCost
    : Math.round(model.hardwareBase * hwTierMultiplier * hardwareColorMultiplier)
  const totalCost    = glassCost + hardwareCost

  // Финмодель: цена = себестоимость / (1 − расходы − маржа)
  const expensesDecimal = expensesPercent / 100
  const marginDecimal   = margin / 100
  const divisor         = 1 - expensesDecimal - marginDecimal
  const basePrice       = divisor > 0 ? Math.round(totalCost / divisor) : 0
  const expensesAmount  = Math.round(basePrice * expensesDecimal)

  // Партнёрка — grossup (правильная формула, не аддитивная)
  const partnerDecimal   = partnerPercent / 100
  const priceWithPartner = partnerDecimal > 0 ? basePrice / (1 - partnerDecimal) : basePrice
  const partnerAmount    = Math.round(priceWithPartner - basePrice)

  // Скидка
  const discountDecimal = discount / 100
  const finalPrice      = Math.round(priceWithPartner * (1 - discountDecimal))
  const discountAmount  = Math.round(priceWithPartner - finalPrice)

  // Услуги
  const serviceLines: ServiceLine[] = []
  const mountingSvc = services.find(s => s.name === 'Монтаж душевой перегородки')
  const deliverySvc = services.find(s => s.name === 'Доставка Москва')
  const liftingSvc  = services.find(s => s.name === 'Подъём на этаж')

  if (withMounting && mountingSvc) {
    const price = mountingSvc.sale_price ?? mountingSvc.cost_price
    serviceLines.push({
      name: 'Монтаж',
      qty: model.glassCount,
      unit: 'стекло',
      price,
      total: price * model.glassCount,
    })
  }
  if (floors > 0 && liftingSvc) {
    const price = liftingSvc.sale_price ?? liftingSvc.cost_price
    serviceLines.push({
      name: 'Подъём на этаж',
      qty: floors,
      unit: 'этаж',
      price,
      total: price * floors,
    })
  }
  if (withDelivery) {
    if (inputs.deliveryCost != null && inputs.deliveryCost > 0) {
      serviceLines.push({ name: 'Доставка за МКАД', qty: 1, unit: 'рейс', price: inputs.deliveryCost, total: inputs.deliveryCost })
    } else if (deliverySvc) {
      const price = deliverySvc.sale_price ?? deliverySvc.cost_price
      serviceLines.push({ name: 'Доставка', qty: 1, unit: 'рейс', price, total: price })
    }
  }
  const servicesTotal = serviceLines.reduce((s, l) => s + l.total, 0)
  const grandTotal    = finalPrice + servicesTotal

  // Реальная прибыль: цена − себестоимость − расходы (не margin × price!)
  const taxOnFinal  = Math.round(finalPrice * expensesDecimal)
  const profit      = Math.round(finalPrice - totalCost - taxOnFinal)
  const realMargin  = finalPrice > 0 ? (profit / finalPrice) * 100 : 0

  // Минимальная маржа и флаг
  const minMargin      = inputs.minMargin ?? 25
  const belowMinMargin = realMargin < minMargin

  // Заработок менеджера: 2% базовый + 10% от прибыли сверх стандартной маржи
  const standardMarginPct   = inputs.standardMargin ?? margin
  const managerBaseCommission = Math.round(finalPrice * 0.02)
  let managerUpsellBonus = 0
  const stdDenom = 1 - standardMarginPct / 100 - expensesDecimal
  if (stdDenom > 0 && margin > standardMarginPct) {
    const stdBase        = totalCost / stdDenom
    const stdWithPartner = partnerDecimal > 0 ? stdBase / (1 - partnerDecimal) : stdBase
    const stdFinal       = Math.round(stdWithPartner * (1 - discountDecimal))
    const extraRev       = Math.max(0, finalPrice - stdFinal)
    const taxOnExtra     = Math.round(extraRev * expensesDecimal)
    managerUpsellBonus   = Math.round((extraRev - taxOnExtra) * 0.10)
  }
  const managerBonus = managerBaseCommission + managerUpsellBonus

  const tierCfg    = TIER_CONFIGS.find(t => t.value === inputs.tier)!
  const colorLabel = HARDWARE_COLORS.find(c => c.value === inputs.hardwareColor)?.label ?? ''

  const costLines: CostLine[] = [
    {
      name: `Стекло закалённое ${inputs.thickness} мм (${inputs.glassName})`,
      qty: Number(glassArea.toFixed(2)), unit: 'м²',
      price: glassCostPerM2, total: glassCost,
    },
    ...(inputs.customHardwareLines?.length
      ? inputs.customHardwareLines.map(l => ({
          name: `${l.name}${l.color ? ' (' + l.color + ')' : ''}`,
          qty: l.qty, unit: l.unit,
          price: l.unitCost, total: l.total,
        }))
      : [{
          name: `Фурнитура ${colorLabel} (${tierCfg.subtitle})`,
          qty: 1, unit: 'компл.',
          price: hardwareCost, total: hardwareCost,
        }]
    ),
  ]

  const dimStr = model.dimType === 'corner'
    ? `${width}×${width2}×${height} мм`
    : `${width}×${height} мм`

  const clientText = [
    `Душевая перегородка ${model.label} — ${model.desc} [${tierCfg.label}]`,
    `Размер: ${dimStr}`,
    `Стекло: закалённое ${inputs.thickness} мм, ${inputs.glassName}`,
    ...(inputs.customHardwareLines?.length
      ? [
          'Фурнитура:',
          ...inputs.customHardwareLines.map(l =>
            `  — ${l.name}${l.color ? ' (' + l.color + ')' : ''}: ${l.qty} ${l.unit}`
          ),
        ]
      : [`Фурнитура: ${colorLabel}, ${tierCfg.hwDesc}`]
    ),
    '',
    `Стоимость: ${finalPrice.toLocaleString('ru-RU')} ₽`,
    ...serviceLines.map(s => {
      const isDeliveryMkad = s.name === 'Доставка за МКАД' && inputs.kmFromMkad && inputs.kmFromMkad > 0
      const label = isDeliveryMkad ? `Доставка МСК + ${inputs.kmFromMkad} км` : s.name
      return `${label}: ${s.total.toLocaleString('ru-RU')} ₽`
    }),
    ...(serviceLines.length ? [`Итого с услугами: ${grandTotal.toLocaleString('ru-RU')} ₽`] : []),
  ].join('\n')

  return {
    glassArea, glassCost, hardwareCost, totalCost,
    expensesPercent, expensesAmount,
    basePrice,
    partnerAmount, priceWithPartner: Math.round(priceWithPartner),
    discountAmount, finalPrice,
    serviceLines, servicesTotal, grandTotal,
    margin: Number(realMargin.toFixed(1)),
    profit,
    managerBaseCommission, managerUpsellBonus, managerBonus,
    belowMinMargin,
    clientText, costLines,
  }
}
