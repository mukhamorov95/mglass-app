// Сколько петель на распашную дверь — одно место для 3D и для цены.
//
// Сейчас (по умолчанию) — по габариту: 3 петли при ширине больше 0,7 м или высоте больше
// 2,2 м. Так считала геометрия (assembly.ts), и так считает цена: петли — это точки в сцене.
// По паспорту — по весу двери против нагрузки «на 2 петли» с карточки поставщика: заказ
// 0245 на 2310 (дверь 650 × 2310 × 8, ~30 кг, FDP-232 держит 35 кг) обходится двумя петлями,
// а габаритное правило ставит три. Переключение — решение 2 маршрута SHOWROOM_COST_ROUTE.

export const GLASS_KG_PER_M2_MM = 2.5   // закалённое стекло: 2,5 кг на м² на каждый мм толщины

export const doorKg = (widthM: number, heightM: number, thicknessMm: number) =>
  Math.round(widthM * heightM * thicknessMm * GLASS_KG_PER_M2_MM * 10) / 10

export const hingesBySize = (widthM: number, heightM: number) => (widthM > 0.7 || heightM > 2.2 ? 3 : 2)

// Паспорт держит дверь двумя петлями — две. Тяжелее — три и предупреждение: паспорта на три
// петли у поставщика нет, третья петля здесь — запас, а не расчёт.
export function hingesByPassport(widthM: number, heightM: number, thicknessMm: number, kgPer2: number) {
  const kg = doorKg(widthM, heightM, thicknessMm)
  return { n: kg <= kgPer2 ? 2 : 3, kg, overPassport: kg > kgPer2 }
}
