// Слой фактов экономики заказа (docs: маршрут экономики, раздел 3). Физические объёмы отделены
// от их оценки в рублях: новые схемы оценки добавляются рядом, объёмы не переписываются.
// Модуль не возвращает цену клиенту — её считает только calcItem / computeQuoteItem.

export type OperationCode =
  | 'material' | 'components' | 'frame_metal' | 'consumables' | 'packaging'
  | 'tempering' | 'facet' | 'triplex' | 'frame_paint'
  | 'cutting' | 'curved' | 'edge' | 'drilling' | 'cutout' | 'sandblast' | 'film' | 'design'
  | 'frame_cutting' | 'frame_welding' | 'assembly' | 'transport'
  | 'underlay' | 'complex_shape' | 'commission'
  | 'overhead_allowance' | 'scrap_allowance' | 'rounding' | 'unclassified'

export type DriverUnit = 'm2' | 'lm' | 'pcs' | 'holes' | 'cutouts' | 'trip' | 'rub'
export type Driver = { unit: DriverUnit; qty: number | null }

export type Channel = 'b2b' | 'd2c' | 'b2c' | 'unknown'
export type OrderRef = {
  orderId: number
  channel: Channel
  channelSource: 'explicit' | 'derived' | 'missing'
  isInternal: boolean
}

export type Part = {
  partKey: string                 // заказ:позиция:слой
  materialId: number | null
  thicknessMm: number | null
  widthMm: number | null
  heightMm: number | null
  qty: number | null
  shape: 'rect' | 'curved' | 'unknown'
  edgeType: string | null         // в позиции не хранится
  holes: { diameterMm: number | null; qty: number | null }[]
  cutouts: { type: string | null; qty: number | null }[]
  color: string | null
  drawingRef: string | null
}

export type Fact = {
  orderId: number
  item: number | null
  layer: number | null            // null — строка всей позиции
  partKey: string | null
  op: OperationCode
  driver: Driver
  materialId: number | null
}

export type ValuationScheme = 'stored' | 'standard' | 'actual'
export type Valuation = {
  scheme: ValuationScheme
  version: string
  amountGross: number | null      // как платим, с НДС если он есть; null — цены нет, это не ноль
  rate: number | null
  rateSource: string
}

export type CostLine = Fact & { label: string; value: Valuation }
