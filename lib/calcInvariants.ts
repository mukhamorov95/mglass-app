// Правила, при которых расчёт можно записать. Живут отдельно от маршрута, чтобы
// их можно было проверить тестом без сети и базы.
//
// Почему на сервере, а не на экране: до 07.09.2026 расчёт писался в базу прямо из
// браузера, и любое правило в интерфейсе обходила вкладка, открытая до выката —
// расчёт №134 так и сохранился без клиента через пять часов после правки.

export type CalcProductType = 'mirror' | 'loft' | 'shower' | 'railing' | 'quick' | 'build'

export const CALC_PRODUCT_TYPES: CalcProductType[] = ['mirror', 'loft', 'shower', 'railing', 'quick', 'build']

export type CalcCheckInput = {
  product_type: CalcProductType
  final_price: number
  base_price: number
  margin: number
  client_name?: string
  client_phone?: string
  deal_id?: number | null
  amo_lead_id?: number | null
  discount?: number | null
  input_data?: Record<string, unknown>
}

export type CalcCheck = { ok: true } | { ok: false; error: string }

// Продукты, у которых расчёт — шаг продажи, а не прикидка. Без клиента такой
// расчёт не заводит сделку и теряется, поэтому имя и телефон обязательны.
// «Быстрый расчёт» (quick) намеренно свободен: им считают на бегу, по телефону.
const CLIENT_REQUIRED: CalcProductType[] = ['build']

export const phoneDigits = (v?: string) => (v ?? '').replace(/\D/g, '')

export function checkCalculation(p: CalcCheckInput): CalcCheck {
  if (!Number.isFinite(p.final_price) || p.final_price < 0) {
    return { ok: false, error: 'Цена не посчитана' }
  }
  if (!Number.isFinite(p.base_price) || p.base_price < 0) {
    return { ok: false, error: 'Базовая цена не посчитана' }
  }
  // Маржа выше 90% почти всегда значит, что прибыль посчитана без вычета услуг.
  if (!Number.isFinite(p.margin) || p.margin > 95 || p.margin < -100) {
    return { ok: false, error: `Маржа ${p.margin}% — похоже на ошибку расчёта` }
  }
  // calculations.discount — проценты (numeric(5,2)), их так и показывают «Расчёты» и печать.
  // Быстрый расчёт до 01.10.2026 слал туда рубли: от 1000 ₽ база отвечала «numeric field
  // overflow», меньше — легло бы «−500%».
  if (p.discount != null && (!Number.isFinite(p.discount) || p.discount < 0 || p.discount > 100)) {
    return { ok: false, error: `Скидка ${p.discount} — должна быть в процентах, от 0 до 100` }
  }

  // Расчёт внутри сделки: клиент уже известен из карточки, спрашивать нечего.
  // Сделка AmoCRM — то же самое: клиент ведётся там (решение владельца 30.09).
  if (CLIENT_REQUIRED.includes(p.product_type) && !p.deal_id && !p.amo_lead_id) {
    if ((p.client_name ?? '').trim().length < 2) {
      return { ok: false, error: 'Нужно имя клиента — иначе расчёт не станет сделкой' }
    }
    if (phoneDigits(p.client_phone).length < 10) {
      return { ok: false, error: 'Нужен телефон клиента — иначе расчёт не станет сделкой' }
    }
  }

  return { ok: true }
}

// Скидка в рублях → проценты от суммы, с которой её сняли. Два знака — как в колонке.
export function discountPercentOf(discountRub: number, baseRub: number): number {
  if (!(baseRub > 0) || !(discountRub > 0)) return 0
  return Math.min(100, Math.round((discountRub / baseRub) * 10000) / 100)
}
