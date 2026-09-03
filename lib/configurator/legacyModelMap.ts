// Легаси-калькулятор душевой (app/calculator/shower) хранит id моделей ЛАТИНИЦЕЙ
// (M1…M12, включая M3/M5/M6). Конфигуратор — КИРИЛЛИЦЕЙ и только девять моделей
// (М1, М2, М4, М7…М12). Маппинг явный, а не транслитерация «M→М»: у M3/M5/M6
// модельного ряда конфигуратора нет, значит комплекта нет → null. Это ровно то
// место, где буквы-двойники (латинская M и кириллическая М) тихо разъезжаются,
// поэтому whitelist и тест.
export const LEGACY_TO_CONFIGURATOR: Record<string, string> = {
  M1: 'М1', M2: 'М2', M4: 'М4', M7: 'М7', M8: 'М8', M9: 'М9', M10: 'М10', M11: 'М11', M12: 'М12',
}

// Код модели в конфигураторе по легаси-id, либо null если комплекта в новом ряду нет.
export function configuratorCode(legacyModelId: string): string | null {
  return LEGACY_TO_CONFIGURATOR[legacyModelId] ?? null
}
