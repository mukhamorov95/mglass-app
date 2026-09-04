// М1: единый ключ сделки B2C — нормализованный телефон.
//
// В B2C нет сквозного id: заявка живёт в crm_leads, расчёт в calculations,
// договор в contracts (телефон внутри JSON), заказ в orders, замер в
// measure_requests, монтаж в installations. Связывает их только телефон, и он
// везде записан по-разному: «8(915)129-12-77», «+7 915 129-12-77», «89151291277».
// Поэтому сравниваем не строки, а последние 10 цифр — это и есть номер без кода
// страны и без форматирования.

export function phoneKey(raw: unknown): string | null {
  const digits = String(raw ?? '').replace(/\D/g, '')
  if (digits.length < 10) return null
  return digits.slice(-10)
}

export function samePhone(a: unknown, b: unknown): boolean {
  const ka = phoneKey(a)
  return ka != null && ka === phoneKey(b)
}

// Человеческий вид: +7 (915) 129-12-77
export function formatPhone(raw: unknown): string {
  const k = phoneKey(raw)
  if (!k) return String(raw ?? '').trim()
  return `+7 (${k.slice(0, 3)}) ${k.slice(3, 6)}-${k.slice(6, 8)}-${k.slice(8)}`
}

// Телефон из произвольного места: строка, объект договора (customer JSON) и т.п.
export function extractPhone(source: unknown): string | null {
  if (!source) return null
  if (typeof source === 'string') return phoneKey(source)
  if (typeof source === 'object') {
    const rec = source as Record<string, unknown>
    for (const field of ['phone', 'client_phone', 'contact_phone', 'tel']) {
      const k = phoneKey(rec[field])
      if (k) return k
    }
  }
  return null
}

// Позвонить и написать прямо с карточки: на телефоне это самый частый жест
// менеджера, а номер до сих пор был просто текстом, который надо выделять.
// WhatsApp принимает номер без плюса и знаков.
export function telHref(raw: unknown): string | null {
  const k = phoneKey(raw)
  return k ? `tel:+7${k}` : null
}
export function waHref(raw: unknown): string | null {
  const k = phoneKey(raw)
  return k ? `https://wa.me/7${k}` : null
}
