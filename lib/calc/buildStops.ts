import { partForItem } from '@/lib/configurator/parts/registry'
import { doorKg } from '@/lib/configurator/hinges'

// Расчёт по чертежу: что остановить до КП. Чистая функция от строк расчёта и того, что
// менеджер переписал с чертежа. Остановка — вопрос, без ответа на который стекло нельзя
// отдавать в закалку (отверстия после закалки не сверлят); пометка — для сведения.
// Маршрут docs/configurator/SHOWROOM_COST_ROUTE.md, этап Ч1.

export type StopLine = {
  role: string; label: string; itemId?: string
  ref?: { base: string }; chromeFallback?: boolean
  qty: number; specs?: Record<string, string>
}
export type StopInput = {
  lines: StopLine[]
  missing: { role: string; label: string; reason: string }[]
  drawn?: Record<string, string>          // роль → артикул, как подписан на чертеже
  doors?: { w: number; h: number }[]      // распашные двери, мм (с чертежа или из геометрии)
  thicknessMm: number
  swingDoors: number
  heightMm: number
  heightRange?: [number, number]
  spliced?: { label: string; piece: number; stock: number }[]   // погонный кусок длиннее хлыста — набран со стыком
}
export type BuildStop = { kind: 'analog' | 'hole' | 'door-weight' | 'oversize' | 'no-colour-price'; text: string }
export type BuildNote = { kind: 'analog' | 'no-passport' | 'hinge-reserve' | 'nonstandard' | 'splice'; text: string }

// Роли, под которые сверлят или вырезают стекло: аналог с другой разметкой — брак после закалки.
const DRILL_ROLES = new Set(['hinge', 'handle', 'mount-glass', 'mount-corner', 'mount-diag45'])

const GLASS_HOLE = /к\s+стеклу|держател[ья]\s+стекла|сквозн/i

const ART = /[A-ZА-Я]{1,5}-\d+(?:\.\d+)?/i
export const articleOf = (s: string | undefined) => (s ?? '').match(ART)?.[0].toUpperCase() ?? ''
const lineArticle = (l: StopLine) => articleOf(l.ref?.base) || articleOf(l.label)

const holeSpec = (specs?: Record<string, string>) =>
  Object.entries(specs ?? {}).find(([k]) => /диаметр выреза|отверсти/i.test(k))?.[1]

// «до 35 кг на 2 петли» → 35
export function loadPer2(label: string, specs?: Record<string, string>): number | null {
  const passport = partForItem(label, 'hinge')?.load?.kgPer2
  if (passport) return passport
  const text = Object.entries(specs ?? {}).find(([k]) => /нагрузк/i.test(k))?.[1] ?? ''
  const m = text.replace(',', '.').match(/(\d+(?:\.\d+)?)\s*кг(?:\s*на\s*(\d+)\s*пет)?/i)
  if (!m) return null
  const kg = Number(m[1]), per = Number(m[2] ?? 2)
  return per > 0 ? (kg / per) * 2 : null
}

export function buildStops(inp: StopInput): { stops: BuildStop[]; notes: BuildNote[] } {
  const stops: BuildStop[] = []
  const notes: BuildNote[] = []

  for (const l of inp.lines) if (l.chromeFallback) {
    stops.push({ kind: 'no-colour-price', text: `${l.label}: нет цены в выбранном цвете — взята цена хрома` })
  }

  for (const [role, drawn] of Object.entries(inp.drawn ?? {})) {
    const want = articleOf(drawn)
    const line = inp.lines.find(l => l.role === role)
    if (!want || !line) continue
    const have = lineArticle(line)
    if (!have || have === want) continue
    if (DRILL_ROLES.has(role)) {
      const hole = holeSpec(line.specs)
      stops.push({ kind: 'analog', text: `На чертеже ${want}, в расчёте ${have} — аналог: сверить отверстия до закалки${hole ? ` (у ${have}: ${hole})` : ''}` })
    } else {
      notes.push({ kind: 'analog', text: `На чертеже ${want}, в расчёте ${have}` })
    }
  }

  // Крепление трубы к стеклу и держатель стекла садятся на болт сквозь полотно: диаметр и
  // место отверстия должны быть на чертеже, иначе стекло уйдёт в закалку без него.
  // Угловой соединитель труба-труба (та же роль) стекло не сверлит — поэтому по названию.
  for (const l of inp.lines) {
    if (l.role === 'hinge' || l.role === 'handle') continue
    const hole = holeSpec(l.specs)
    if (hole || GLASS_HOLE.test(l.label)) {
      stops.push({ kind: 'hole', text: `Отверстие в стекле ${hole ?? '(размер — по карточке)'} под ${lineArticle(l) || l.label} — проверить, есть ли на чертеже` })
    }
  }

  const hinge = inp.lines.find(l => l.role === 'hinge')
  if (hinge && inp.swingDoors > 0 && inp.doors?.length) {
    const per2 = loadPer2(hinge.label, hinge.specs)
    const perDoor = Math.round(hinge.qty / inp.swingDoors)
    if (per2 == null) notes.push({ kind: 'no-passport', text: `${lineArticle(hinge) || hinge.label}: нет паспорта нагрузки — вес двери не проверен` })
    else for (const d of inp.doors) {
      const kg = doorKg(d.w / 1000, d.h / 1000, inp.thicknessMm)
      if (kg <= per2) continue
      if (perDoor >= 3) notes.push({ kind: 'hinge-reserve', text: `Дверь ${d.w}×${d.h} — ${kg} кг, паспорт ${per2} кг на 2 петли; стоит ${perDoor}, паспорта на ${perDoor} нет` })
      else stops.push({ kind: 'door-weight', text: `Дверь ${d.w}×${d.h} весит ${kg} кг, петли ${lineArticle(hinge)} держат ${per2} кг на две — нужна третья петля или другая петля` })
    }
  }

  for (const m of inp.missing) if (m.reason === 'кусок длиннее хлыста') {
    stops.push({ kind: 'oversize', text: `${m.label}: кусок длиннее хлыста — стык или другая длина` })
  }

  const splices = new Map<string, number>()
  for (const x of inp.spliced ?? []) {
    const text = `${x.label}: кусок ${x.piece} длиннее хлыста ${x.stock} — набран со стыком`
    splices.set(text, (splices.get(text) ?? 0) + 1)
  }
  for (const [text, n] of splices) notes.push({ kind: 'splice', text: n > 1 ? `${text} (×${n})` : text })

  const [lo, hi] = inp.heightRange ?? [0, Infinity]
  if (inp.heightMm < lo || inp.heightMm > hi) notes.push({ kind: 'nonstandard', text: `Высота ${inp.heightMm} вне сетки модели ${lo}–${hi} — нестандарт` })

  return { stops, notes }
}
