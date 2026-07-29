// Себестоимость труда цеха как ЖИВАЯ ставка, а не константа за единицу.
//
// Владелец платит мастерам фиксированный оклад в месяц. Значит реальная
// стоимость операции = оклад ÷ фактический объём за период. При росте объёма
// ставка падает (operating leverage): те же 160 000 ₽ резки на 777 м² дают
// 206 ₽/м², а на 1 500 м² — уже 107 ₽/м². Константа за единицу этого не видит
// и потому либо завышает при росте, либо занижает при спаде.
//
// Числа июля 2026 (проверено по b2b_orders):
//   резка 160к / 777 м² = 206 ₽/м²   — в себестоимости заказа НЕ учитывалась
//   сверловка 150к / 49 дет = 3 061 ₽/дет — не учитывалась (объём мал → ставка велика)
//   кромка 120к / 3 284 пог.м = 36.5 ₽/м — калькулятор берёт 40 (с запасом)
//   упаковка 130к / 777 м² = 167 ₽/м²  — калькулятор берёт 120 (занижено на 47)

export type ShopSalaries = {
  cutting: number    // резка
  drilling: number   // сверловка
  edge: number       // полировка кромки прямолинейной
  packaging: number  // упаковка
}

// Оклады со слов владельца (29.07.2026). Вынести в settings, когда появится
// экран редактирования — пока единственный источник правды здесь.
export const DEFAULT_SHOP_SALARIES: ShopSalaries = {
  cutting: 160_000,   // Бекмурза
  drilling: 150_000,  // Адилет
  edge: 120_000,
  packaging: 130_000,
}

export const SALARY_LABEL: Record<keyof ShopSalaries, string> = {
  cutting: 'Резка',
  drilling: 'Сверловка',
  edge: 'Кромка',
  packaging: 'Упаковка',
}

export type ShopThroughput = {
  netM2: number       // м² нетто, обработано за период
  edgeM: number       // пог.м кромки (периметр × кол-во)
  drilledPcs: number  // деталей со сверловкой
  packedPcs: number   // деталей упаковано (обычно = всем деталям)
}

export type LaborRates = {
  cuttingPerM2: number
  drillingPerPiece: number
  edgePerM: number
  packagingPerM2: number
  monthlyLaborTotal: number
  // Доля от выручки — «сколько цеха в рубле продаж». Заполняется вызывающим,
  // если известна выручка периода.
}

// Ставка = оклад ÷ объём. Ноль объёма → ноль ставки (не делим на ноль): операция
// в этом периоде не выполнялась, вменять её стоимость некому.
function rate(salary: number, volume: number): number {
  return volume > 0 ? salary / volume : 0
}

export function laborRates(sal: ShopSalaries, thru: ShopThroughput): LaborRates {
  return {
    cuttingPerM2:    rate(sal.cutting, thru.netM2),
    drillingPerPiece: rate(sal.drilling, thru.drilledPcs),
    edgePerM:        rate(sal.edge, thru.edgeM),
    packagingPerM2:  rate(sal.packaging, thru.netM2),  // упаковка ₽/м², как в калькуляторе
    monthlyLaborTotal: sal.cutting + sal.drilling + sal.edge + sal.packaging,
  }
}

// Стоимость труда на конкретную позицию по живым ставкам периода.
export type PieceLaborInput = {
  netM2: number       // площадь нетто позиции (× количество)
  edgeM: number       // пог.м кромки позиции (периметр × количество)
  drilledPcs: number  // сколько деталей позиции сверлится (0, если нет отверстий)
  pcs: number         // количество деталей в позиции (для упаковки)
}

export function pieceLaborCost(rates: LaborRates, p: PieceLaborInput): {
  cutting: number; drilling: number; edge: number; packaging: number; total: number
} {
  const cutting   = Math.round(p.netM2 * rates.cuttingPerM2)
  const drilling  = Math.round(p.drilledPcs * rates.drillingPerPiece)
  const edge      = Math.round(p.edgeM * rates.edgePerM)
  const packaging = Math.round(p.netM2 * rates.packagingPerM2)
  return { cutting, drilling, edge, packaging, total: cutting + drilling + edge + packaging }
}
