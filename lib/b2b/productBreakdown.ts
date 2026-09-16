// Разбор себестоимости изделия производства на строки.
//
// Правило владельца 16.09.2026: у любого итога должна открываться разбивка —
// «зеркало столько, лента столько, комплектующие столько». Итог без состава
// считать нельзя. В просчётах до 16.09 состав в позицию не сохранялся, поэтому
// здесь он восстанавливается из комплектации (comment) и пересчитывается тем же
// калькулятором, что считал заказ. Пересчёт сверяем с сохранённой суммой: если
// сошлось — показываем как есть, если нет (цены справочника с тех пор менялись) —
// показываем и честно говорим о расхождении.

export type ProductSpec = {
  mirrorName: string
  mirrorMm: number
  hasLighting: boolean
  metalFrame: boolean
  curved: boolean
  underlayCost: number
  ledShort: string | null     // «EL-24V-96N» из комплектации
  frameShort: string | null   // каркас (профиль сзади)
  psuShort: string | null     // «EL-LB2472»
  buttonType: 'none' | 'sensor' | 'wave'
}

const num = (x: unknown) => Number(x) || 0

// «Зеркало с подсветкой Осветлённое 4 мм» → { mirrorName: 'Осветлённое', hasLighting: true }
export function parseProductSpec(materialName: string, comment: string | null | undefined, thickness: number): ProductSpec | null {
  const name = String(materialName ?? '').trim()
  if (!/^Зеркало/i.test(name)) return null   // лофт и прочее — отдельным разбором

  const metalFrame = /в металлической раме/i.test(name)
  const hasLighting = /с подсветкой/i.test(name)
  const mirrorName = name
    .replace(/^Зеркало( с подсветкой)?( в металлической раме)?\s*/i, '')
    .replace(/\s*\d+([.,]\d+)?\s*мм\s*$/i, '')
    .trim()

  const parts = String(comment ?? '').split('·').map(s => s.trim()).filter(Boolean)
  const find = (re: RegExp) => parts.find(p => re.test(p)) ?? null

  const underlayRaw = find(/подложка подрядчика/i)
  const underlayCost = underlayRaw ? num(underlayRaw.replace(/[^\d]/g, '')) : 0

  const ledRaw = find(/^лента:/i)
  const ledShort = ledRaw ? ledRaw.replace(/^лента:\s*/i, '').replace(/\s*\d+K\b/i, '').replace(/\s*\d+V\s*$/i, '').trim() : null

  const frameRaw = find(/^каркас:/i)
  const frameShort = frameRaw ? frameRaw.replace(/^каркас:\s*/i, '').trim() : null

  // Не `\b`: граница слова в JS — ASCII, после кириллицы она не срабатывает
  // (на этом же уже спотыкались в lib/breakeven.ts).
  const psuRaw = find(/^БП[\s:]/i)
  const psuShort = psuRaw ? psuRaw.replace(/^БП\s*/i, '').trim() : null

  return {
    mirrorName,
    mirrorMm: num(thickness),
    hasLighting,
    metalFrame,
    curved: parts.some(p => /криволинейн/i.test(p)),
    underlayCost,
    ledShort: ledShort || null,
    frameShort: frameShort || null,
    psuShort: psuShort || null,
    buttonType: parts.some(p => /датчик взмаха/i.test(p)) ? 'wave'
      : parts.some(p => /сенсорная кнопка/i.test(p)) ? 'sensor' : 'none',
  }
}

export type BreakdownLine = { name: string; qty: number; unit: string; price?: number; total: number }

export type ProductBreakdown = {
  lines: BreakdownLine[]
  sum: number            // сумма строк
  stored: number         // себестоимость, сохранённая в позиции
  reconciles: boolean    // сумма строк = сохранённая (разницу ≤1 ₽ считаем округлением)
  source: 'saved' | 'recalc'
}

// Свести строки состава с сохранённой суммой позиции.
export function reconcile(lines: BreakdownLine[], stored: number, source: 'saved' | 'recalc'): ProductBreakdown {
  const sum = Math.round(lines.reduce((s, l) => s + num(l.total), 0))
  return { lines, sum, stored: Math.round(stored), reconciles: Math.abs(sum - Math.round(stored)) <= 1, source }
}
