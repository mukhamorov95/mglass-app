import type { SupabaseClient } from '@supabase/supabase-js'

// Внутренние ставки B2B-калькулятора живут в справочнике b2b_rates (/admin/b2b-rates),
// а не в коде: подорожала закалка — правка в админке, а не деплой (решение владельца
// 22.09.2026, маршрут docs/pricing/RATES_DIRECTORY_ROUTE.md).
// Заводские значения ниже — то, что жило в коде до 23.09. Ими подменяется только
// ставка, строки которой нет в справочнике, и вызывающий обязан сказать об этом
// вслух (missing): тихая подмена — та же ошибка, что тихий ноль.

export type MinPriceReason = 'glass_tempering' | 'tinted_tempering' | 'mirror_no_tempering' | 'narrow_detail'

export type B2BRates = {
  temperingPerM2: Record<number, number>   // закалка по толщине, ₽/м² с НДС
  edgePerM: number                         // кромка, ₽/м.п.
  transportPerPiece: number                // доставка на закалку, ₽/деталь
  packagingPerM2: number                   // упаковка, ₽/м²
  minLine: Record<MinPriceReason, number>  // минимальная цена позиции, ₽/шт с НДС
}

export type RateSpec = { key: string; label: string; unit: string; sort: number; value: number }

const TEMPERING_DEFAULTS: Record<number, number> = { 4: 300, 5: 350, 6: 400, 8: 500, 10: 600, 12: 950 }

const MIN_LINE_KEYS: Record<MinPriceReason, string> = {
  glass_tempering:     'min_glass_tempering',
  tinted_tempering:    'min_tinted_tempering',
  mirror_no_tempering: 'min_mirror',
  narrow_detail:       'min_narrow_detail',
}

export const B2B_RATE_SPECS: RateSpec[] = [
  ...Object.entries(TEMPERING_DEFAULTS).map(([mm, value], i) => ({
    key: `tempering_${mm}`, label: `Закалка ${mm} мм`, unit: '₽/м²', sort: 10 + i, value,
  })),
  { key: 'edge_per_m',          label: 'Кромка',                       unit: '₽/м.п.',   sort: 30, value: 40 },
  { key: 'transport_per_piece', label: 'Доставка на закалку',          unit: '₽/деталь', sort: 40, value: 77 },
  { key: 'packaging_per_m2',    label: 'Упаковка (гофрокартон)',       unit: '₽/м²',     sort: 50, value: 120 },
  { key: 'min_glass_tempering',  label: 'Мин. цена позиции — стекло с закалкой', unit: '₽/шт', sort: 60, value: 2500 },
  { key: 'min_tinted_tempering', label: 'Мин. цена позиции — тонированное, сатин, рифлёное, декор с закалкой', unit: '₽/шт', sort: 61, value: 3000 },
  { key: 'min_mirror',           label: 'Мин. цена позиции — зеркало без закалки', unit: '₽/шт', sort: 62, value: 1500 },
  { key: 'min_narrow_detail',    label: 'Мин. цена позиции — узкая деталь (сторона < 250 мм)', unit: '₽/шт', sort: 63, value: 1500 },
]

const specOf = (key: string) => B2B_RATE_SPECS.find(s => s.key === key)!

export const DEFAULT_B2B_RATES: B2BRates = {
  temperingPerM2: { ...TEMPERING_DEFAULTS },
  edgePerM: specOf('edge_per_m').value,
  transportPerPiece: specOf('transport_per_piece').value,
  packagingPerM2: specOf('packaging_per_m2').value,
  minLine: {
    glass_tempering:     specOf(MIN_LINE_KEYS.glass_tempering).value,
    tinted_tempering:    specOf(MIN_LINE_KEYS.tinted_tempering).value,
    mirror_no_tempering: specOf(MIN_LINE_KEYS.mirror_no_tempering).value,
    narrow_detail:       specOf(MIN_LINE_KEYS.narrow_detail).value,
  },
}

export type RateRow = { key: string; value: number | string | null }

// rows = null — справочник не прочитался: все ставки заводские, и все в missing.
export function ratesFromRows(rows: RateRow[] | null | undefined): { rates: B2BRates; missing: string[] } {
  const got = new Map<string, number>()
  for (const r of rows ?? []) {
    const v = Number(r.value)
    if (r.value !== null && r.value !== '' && Number.isFinite(v) && v >= 0) got.set(r.key, v)
  }
  const missing: string[] = []
  const pick = (key: string): number => {
    const v = got.get(key)
    if (v !== undefined) return v
    missing.push(specOf(key).label)
    return specOf(key).value
  }

  // Закалка по толщине: заводские толщины обязательны, новые (tempering_15)
  // из справочника подхватываются без правки кода.
  const temperingPerM2: Record<number, number> = {}
  for (const mm of Object.keys(TEMPERING_DEFAULTS)) temperingPerM2[Number(mm)] = pick(`tempering_${mm}`)
  for (const [key, v] of got) {
    const m = /^tempering_(\d+)$/.exec(key)
    if (m) temperingPerM2[Number(m[1])] = v
  }

  const rates: B2BRates = {
    temperingPerM2,
    edgePerM: pick('edge_per_m'),
    transportPerPiece: pick('transport_per_piece'),
    packagingPerM2: pick('packaging_per_m2'),
    minLine: {
      glass_tempering:     pick(MIN_LINE_KEYS.glass_tempering),
      tinted_tempering:    pick(MIN_LINE_KEYS.tinted_tempering),
      mirror_no_tempering: pick(MIN_LINE_KEYS.mirror_no_tempering),
      narrow_detail:       pick(MIN_LINE_KEYS.narrow_detail),
    },
  }
  return { rates, missing }
}

export async function loadB2BRates(sb: SupabaseClient): Promise<{ rates: B2BRates; missing: string[] }> {
  const { data, error } = await sb.from('b2b_rates').select('key, value')
  return ratesFromRows(error ? null : (data as RateRow[] | null))
}

export function ratesMissingNote(missing: string[]): string | null {
  if (missing.length === 0) return null
  return `Нет в справочнике ставок: ${missing.join(', ')} — взяты заводские значения. Проверьте «Ставки производства стекла».`
}
