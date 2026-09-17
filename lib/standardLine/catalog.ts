import type { BuildRequest } from '@/lib/calc/buildPrice'

// Стартовый набор стандартных изделий: то, что можно держать заготовками на складе
// (закалённые прозрачные панели ходовых размеров + комплекты фурнитуры по цвету) и
// собирать под заказ. Геометрия — модели конфигуратора, цена — тот же расчёт, что у
// менеджера во вкладке «Расчёт» (lib/calc/buildPrice.ts).

export type StandardFinish = 'black' | 'chrome'
export const FINISH_LABELS: Record<StandardFinish, string> = { black: 'чёрный матовый', chrome: 'хром' }

export type MarketPrice = { brand: string; price: number; note: string }

export type StandardSku = {
  code: string
  title: string
  finish: StandardFinish
  build: BuildRequest
  // Розница конкурентов на сопоставимое изделие, снято 16.09.2026 (knotlor.ru,
  // vseinstrumenti.ru, сайты брендов). Ориентир для цены на сайте, не вход формулы.
  market: MarketPrice[]
}

const WALK_IN_MARKET: Record<number, MarketPrice[]> = {
  900: [
    { brand: 'Aquatek', price: 12020, note: '8 мм, от' },
    { brand: 'Vincea', price: 18640, note: '8 мм' },
    { brand: 'RGW', price: 27288, note: '8 мм' },
    { brand: 'Knotlor', price: 22700, note: 'хром' },
  ],
  1000: [
    { brand: 'Abber', price: 19400, note: '6 мм' },
    { brand: 'Knotlor', price: 34300, note: 'рифлёное, чёрный' },
  ],
  1200: [
    { brand: 'Loranto', price: 16490, note: '8 мм' },
    { brand: 'Vincea', price: 22570, note: '8 мм' },
    { brand: 'AM.PM', price: 23290, note: '6 мм' },
    { brand: 'Ambassador', price: 24300, note: '8 мм' },
    { brand: 'RGW', price: 30845, note: '8 мм' },
    { brand: 'Knotlor', price: 38600, note: 'рифлёное, чёрный' },
  ],
}

const NICHE_DOOR_MARKET: Record<number, MarketPrice[]> = {
  1000: [
    { brand: 'Knotlor', price: 38600, note: 'дверь 90, чёрный' },
  ],
  1200: [
    { brand: 'Vegas Glass', price: 38958, note: 'ZP NOVO 120, top-santehnika' },
    { brand: 'Knotlor', price: 42000, note: 'дверь 120, чёрный' },
  ],
}

function walkIn(width: number, finish: StandardFinish): StandardSku {
  return {
    code: `WI-${String(width / 10).padStart(3, '0')}-${finish === 'black' ? 'BL' : 'CR'}`,
    title: `Walk-in ${width}×2000, стекло 8 мм прозрачное, ${FINISH_LABELS[finish]}`,
    finish,
    build: {
      model: 'М1', dims: { width, height: 2000 }, thickness: 8, finishId: finish,
      variant: { mount: 'perp90', profileFrame: 'partial', glassSpan: 'panel' },
    },
    market: WALK_IN_MARKET[width] ?? [],
  }
}

function nicheDoor(width: number, doorWidth: number, finish: StandardFinish): StandardSku {
  return {
    code: `ND-${String(width / 10).padStart(3, '0')}-${finish === 'black' ? 'BL' : 'CR'}`,
    title: `Дверь в нишу ${width}×2000 (дверь ${doorWidth}), стекло 8 мм прозрачное, ${FINISH_LABELS[finish]}`,
    finish,
    build: { model: 'М2', dims: { width, height: 2000, doorWidth }, thickness: 8, finishId: finish },
    market: NICHE_DOOR_MARKET[width] ?? [],
  }
}

export const STANDARD_SKUS: StandardSku[] = (['black', 'chrome'] as StandardFinish[]).flatMap(f => [
  walkIn(900, f), walkIn(1000, f), walkIn(1200, f),
  nicheDoor(1000, 600, f), nicheDoor(1200, 700, f),
])
