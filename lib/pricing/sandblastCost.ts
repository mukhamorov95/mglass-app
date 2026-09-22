// Себестоимость пескоструя за м² — по процессу цеха, а не «на глаз».
//
// Процесс словами владельца (22.09.2026): песочный аппарат с нагнетателем
// (компрессором), песок из мешков; обратную сторону зеркала полностью оклеивают
// плёнкой, чтобы не поцарапать; при рисунке трафарет режут плоттером по чертежу
// или клеят оракал и вручную отклеивают полоски; потом песочат.
//
// Отсюда четыре статьи: плёнка (оракал), песок, время оператора, амортизация
// оборудования. Накладные — процентом сверху, как и у остальных услуг цеха
// (lib/calcServiceCost.ts). Ничего не выдумываем: чего владелец не назвал, то
// возвращается в missing и в сумму не попадает.

export type FilmInput = {
  rollPrice: number      // ₽ за рулон
  rollLengthM: number    // длина рулона, м
  rollWidthM: number     // ширина рулона, м
  layers: number         // сколько м² плёнки уходит на 1 м² изделия (обратная сторона = 1, + трафарет = 2)
  wastePct: number       // обрезки, %
}

export type SandInput = {
  bagPrice: number       // ₽ за мешок
  bagKg: number          // кг в мешке
  kgPerM2: number        // расход на 1 м²
}

export type EquipmentInput = {
  price: number          // стоимость аппарата + компрессора (+ плоттера), ₽
  lifeYears: number      // сколько лет служит
  m2PerMonth: number     // сколько м² песочим в месяц
}

export type SandblastInputs = {
  film: FilmInput | null
  sand: SandInput | null
  minutesPerM2: number | null   // время оператора на 1 м²
  minuteRate: number            // ₽ за минуту работы (из настроек производства)
  equipment: EquipmentInput | null
  overheadPct: number
}

export type CostLine = { name: string; detail: string; rubPerM2: number }

export type SandblastCost = {
  lines: CostLine[]
  directPerM2: number     // плёнка + песок + время + амортизация
  overheadPerM2: number
  costPerM2: number       // итог себестоимости
  missing: string[]       // чего не хватает, чтобы цифра была полной
}

const r2 = (n: number) => Math.round(n * 100) / 100
const rub = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₽`

export function filmPerM2(f: FilmInput): number {
  const area = f.rollLengthM * f.rollWidthM
  if (!(area > 0) || !(f.rollPrice > 0)) return 0
  const base = f.rollPrice / area
  return base * Math.max(0, f.layers) * (1 + Math.max(0, f.wastePct) / 100)
}

export function sandPerM2(s: SandInput): number {
  if (!(s.bagKg > 0) || !(s.bagPrice > 0)) return 0
  return (s.bagPrice / s.bagKg) * Math.max(0, s.kgPerM2)
}

// Амортизация: цена оборудования делится на то, сколько м² оно успеет отпесочить
// за свою жизнь. Так она попадает в каждый м², а не забывается до покупки нового.
export function equipmentPerM2(e: EquipmentInput): number {
  const totalM2 = e.lifeYears * 12 * e.m2PerMonth
  if (!(totalM2 > 0) || !(e.price > 0)) return 0
  return e.price / totalM2
}

export function sandblastCost(p: SandblastInputs): SandblastCost {
  const lines: CostLine[] = []
  const missing: string[] = []

  if (p.film && filmPerM2(p.film) > 0) {
    const perRollM2 = p.film.rollLengthM * p.film.rollWidthM
    lines.push({
      name: 'Плёнка (оракал)',
      detail: `${rub(p.film.rollPrice)} за рулон ${p.film.rollLengthM} × ${p.film.rollWidthM} м = ${perRollM2.toFixed(1)} м², слоёв ${p.film.layers}, обрезки ${p.film.wastePct}%`,
      rubPerM2: r2(filmPerM2(p.film)),
    })
  } else missing.push('плёнка: цена рулона, длина и ширина рулона, сколько слоёв уходит на 1 м²')

  if (p.sand && sandPerM2(p.sand) > 0) {
    lines.push({
      name: 'Песок',
      detail: `${rub(p.sand.bagPrice)} за мешок ${p.sand.bagKg} кг, расход ${p.sand.kgPerM2} кг/м²`,
      rubPerM2: r2(sandPerM2(p.sand)),
    })
  } else missing.push('песок: цена мешка, вес мешка, расход кг на 1 м²')

  if (p.minutesPerM2 && p.minutesPerM2 > 0 && p.minuteRate > 0) {
    lines.push({
      name: 'Работа оператора',
      detail: `${p.minutesPerM2} мин/м² × ${r2(p.minuteRate)} ₽/мин`,
      rubPerM2: r2(p.minutesPerM2 * p.minuteRate),
    })
  } else missing.push('время: сколько минут уходит на 1 м² (оклейка, резка трафарета, сам пескоструй)')

  if (p.equipment && equipmentPerM2(p.equipment) > 0) {
    lines.push({
      name: 'Амортизация оборудования',
      detail: `${rub(p.equipment.price)} на ${p.equipment.lifeYears} лет при ${p.equipment.m2PerMonth} м²/мес`,
      rubPerM2: r2(equipmentPerM2(p.equipment)),
    })
  } else missing.push('оборудование: сколько стоили аппарат, компрессор и плоттер, сколько лет служат, сколько м² песочим в месяц')

  const direct = r2(lines.reduce((s, l) => s + l.rubPerM2, 0))
  const overhead = r2(direct * Math.max(0, p.overheadPct) / 100)
  // Итог выводим суммой показанных чисел, а не отдельным округлением:
  // иначе строки на экране не сойдутся с итогом (наблюдение про равенства).
  return { lines, directPerM2: direct, overheadPerM2: overhead, costPerM2: r2(direct + overhead), missing }
}
