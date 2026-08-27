// Аудит внедрения: что построено и используется ли оно на самом деле.
//
// Главный риск проекта сейчас — не баги, а разрыв между «построено» и «работает».
// За 25–26 августа выкачен огромный контур; по большинству фич adoption ещё
// нельзя судить — они выкачены день-два назад. Отчёт для ВЛАДЕЛЬЦА: он смотрит и
// понимает, что внедрять (обучить людей, дать вход с экрана), а не что чинить.
//
// Два правила честности:
//  • цифра использования — из данных; нет счётчика → 'не измеряется', не выдумываем
//    (docs/ORCHESTRATION.md п.5);
//  • «мертва» и «слишком новая, чтобы судить» — разные вердикты. Фича, выкаченная
//    вчера, не провал: судить рано.

export type FlowVerdict =
  | 'слишком новая'   // выкачена недавно — данных для суждения нет
  | 'ранний старт'    // новая, но уже есть первые использования — хороший знак
  | 'живёт'           // используется в последние 30 дней
  | 'затухает'        // использовалась раньше, но не в последние 30 дней
  | 'мертва'          // существует давно, использований нет вовсе
  | 'не измеряется'   // счётчика в данных нет — adoption не наблюдаем

export type FlowMeasure = {
  usesTotal: number | null    // null = не измеряется
  uses90d: number
  uses30d: number
}

export type FlowSpec = {
  key: string
  title: string
  domain: string
  shipped: string             // дата выката (из git/PR), ISO yyyy-mm-dd
  measurable: boolean         // есть ли в данных счётчик
  note?: string               // пояснение (например, чем меряется / почему не меряется)
}

export type FlowRow = FlowSpec & FlowMeasure & {
  ageDays: number
  verdict: FlowVerdict
  hint?: string               // гипотеза причины для мёртвых/затухающих
}

// Фича моложе этого — «слишком новая, чтобы судить».
export const TOO_NEW_DAYS = 14

export function daysBetween(fromISO: string, now: number): number {
  const t = new Date(fromISO + 'T00:00:00Z').getTime()
  if (Number.isNaN(t)) return 0
  return Math.max(0, Math.floor((now - t) / 86_400_000))
}

export function classify(spec: FlowSpec, m: FlowMeasure, now: number): FlowRow {
  const ageDays = daysBetween(spec.shipped, now)
  const base = { ...spec, ...m, ageDays }

  if (!spec.measurable || m.usesTotal === null) {
    return { ...base, usesTotal: null, verdict: 'не измеряется' }
  }
  const total = m.usesTotal
  const isNew = ageDays < TOO_NEW_DAYS

  let verdict: FlowVerdict
  if (isNew) verdict = total > 0 ? 'ранний старт' : 'слишком новая'
  else if (total === 0) verdict = 'мертва'
  else if (m.uses30d === 0) verdict = 'затухает'
  else verdict = 'живёт'

  return { ...base, verdict }
}

// Порядок вывода: сначала то, что требует решения владельца (мёртвое и
// затухающее старое), потом живое, потом новое, потом неизмеримое.
const ORDER: Record<FlowVerdict, number> = {
  'мертва': 0, 'затухает': 1, 'живёт': 2, 'ранний старт': 3, 'слишком новая': 4, 'не измеряется': 5,
}

export function sortFlows(rows: FlowRow[]): FlowRow[] {
  return rows.slice().sort((a, b) =>
    (ORDER[a.verdict] - ORDER[b.verdict]) || (b.ageDays - a.ageDays) || a.title.localeCompare(b.title, 'ru'))
}

export function summarize(rows: FlowRow[]) {
  const by = (v: FlowVerdict) => rows.filter(r => r.verdict === v).length
  return {
    dead: by('мертва'),
    fading: by('затухает'),
    alive: by('живёт') + by('ранний старт'),
    tooNew: by('слишком новая'),
    unmeasured: by('не измеряется'),
    total: rows.length,
  }
}
