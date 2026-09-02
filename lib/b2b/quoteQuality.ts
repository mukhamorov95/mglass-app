// Полнота просчёта: считает ли менеджер изделие так, чтобы цех увидел работу.
//
// Меряем ДВА разных события, и сливать их в одну цифру нельзя:
//   1) признак «отверстия» (`hasHoles`) — от него зависит, появится ли задача
//      у сверловщика вообще. Поле живёт с 30.06, ноль в нём — это ноль;
//   2) группы «N штук ⌀D» (`holes`) — поле появилось 28.08, до этой даты его
//      не существовало, и ноль там ничего не говорит о работе менеджера.
//
// Третий счётчик — диаметры в комментарии: их пишет разбор чертежа. Без него
// пустое поле групп читается как «данных нет», хотя данные есть, просто в
// другом месте, и просьба перепечатать их — просьба сделать лишнюю работу.

export const HOLES_GROUPS_SINCE = '2026-08-28'   // группы ⌀ — PR #365
export const HAS_HOLES_SINCE    = '2026-06-30'   // признак «отверстия» — с первых очередей цеха

export type QualityRow = {
  week:            string
  manager:         string
  positions:       number
  flagged:         number
  detailed:        number
  diam_in_comment: number
  cutouts:         number
  orders:          number
}

export type Totals = Omit<QualityRow, 'week' | 'manager'>

export const EMPTY_TOTALS: Totals = {
  positions: 0, flagged: 0, detailed: 0, diam_in_comment: 0, cutouts: 0, orders: 0,
}

export function addTotals(a: Totals, b: Totals): Totals {
  return {
    positions:       a.positions + b.positions,
    flagged:         a.flagged + b.flagged,
    detailed:        a.detailed + b.detailed,
    diam_in_comment: a.diam_in_comment + b.diam_in_comment,
    cutouts:         a.cutouts + b.cutouts,
    orders:          a.orders + b.orders,
  }
}

export function sumTotals(list: Totals[]): Totals {
  return list.reduce(addTotals, EMPTY_TOTALS)
}

// null, а не 0: делить не на что — это не «ноль процентов», и на экране должно
// стоять «—». Иначе пустая выборка читается как провал (правило 13).
export function pct(part: number, whole: number): number | null {
  if (whole <= 0) return null
  return Math.round((part / whole) * 100)
}

// Неделя, в которой поля групп ещё не существовало: ноль в `detailed` — свойство
// релиза, а не менеджера. Сравниваем по концу недели: поле выкатили 28.08, и
// неделя, начавшаяся 24.08, возможность им воспользоваться уже давала.
export function groupsFieldExisted(weekStart: string): boolean {
  const end = new Date(`${weekStart}T00:00:00Z`)
  end.setUTCDate(end.getUTCDate() + 6)
  return end.toISOString().slice(0, 10) >= HOLES_GROUPS_SINCE
}

// Все менеджеры периода — колонки таблицы. Считаем по всему периоду, а не по
// неделе: иначе менеджер, у которого на этой неделе не было просчётов, исчезал
// бы из таблицы, и «не считал» стало бы неотличимо от «считал и не отметил».
export function managersInPeriod(rows: QualityRow[]): string[] {
  const seen = new Map<string, number>()
  for (const r of rows) seen.set(r.manager, (seen.get(r.manager) ?? 0) + r.positions)
  return [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => m)
}

// Итог по менеджеру: null означает «просчётов не было», а не «ноль отметок».
export type WeekBlock = {
  week:      string
  total:     Totals
  byManager: Record<string, Totals | null>
}

export function pivotByWeek(rows: QualityRow[], managers: string[]): WeekBlock[] {
  const weeks = new Map<string, Map<string, Totals>>()
  for (const r of rows) {
    const m = weeks.get(r.week) ?? new Map<string, Totals>()
    m.set(r.manager, addTotals(m.get(r.manager) ?? EMPTY_TOTALS, r))
    weeks.set(r.week, m)
  }
  return [...weeks.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([week, m]) => ({
      week,
      total: sumTotals([...m.values()]),
      byManager: Object.fromEntries(managers.map(name => [name, m.get(name) ?? null])),
    }))
}

export function pivotByManager(rows: QualityRow[]): { manager: string; total: Totals }[] {
  const m = new Map<string, Totals>()
  for (const r of rows) m.set(r.manager, addTotals(m.get(r.manager) ?? EMPTY_TOTALS, r))
  return [...m.entries()]
    .map(([manager, total]) => ({ manager, total }))
    .sort((a, b) => b.total.positions - a.total.positions)
}
