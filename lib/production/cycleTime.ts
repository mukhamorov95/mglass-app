// П4 — время этапа (docs/PRODUCTION_PLAN.md, формулировка согласована с оркестратором).
//
// ПОЧЕМУ НЕ ИЗ started_at. В ТЗ время этапа считалось от «взял в работу» до «готово».
// Но «взял» рабочий не жмёт (0 нажатий за два месяца), а автостарт из П2 — слабый сигнал:
// он завышает длительность на всё время, что карточка просто висела открытой.
// Достоверная мера не требует от цеха ничего нового: ИНТЕРВАЛ МЕЖДУ ДВУМЯ ПОДРЯД
// «ГОТОВО» одного человека на одной станции. Считается из completed_by + completed_at,
// которые дал П1, и не зависит от того, приживётся ли автостарт.
//
// ПОЧЕМУ ПАЧКАМИ. Медиана интервала между соседними отметками — 9.5 секунды: цех
// закрывает заказ целиком, а не деталь за деталью (для этого есть кнопка «Готов весь»).
// Поэтому сырой интервал измеряет не работу, а скорость нажатия. Отметки, идущие
// подряд, склеиваются в одну пачку, и время делится на число изделий в ней.
//
// ПОЧЕМУ ОТБРАСЫВАЕМ ЗАГРЯЗНЁННЫЕ ИНТЕРВАЛЫ. Если между двумя отметками на полировке
// человек закрывал ещё и упаковку, интервал измеряет обе работы сразу. Приписать его
// полировке — соврать. Такие интервалы не корректируются, а выбрасываются, и доля
// выброшенного показывается: пустая клетка честнее правдоподобного числа.
//
// Чистая логика — ни Supabase, ни React.

// Отметки, разделённые меньше чем этим, — одно нажатие «Готов весь», а не две работы.
export const BATCH_GAP_SEC = 60

// Интервал длиннее — это обед, пересменка или ночь, а не одна операция.
// По боевым данным медиана интервала между пачками 34 минуты, p90 — 21 час:
// граница отделяет работу от перерыва, а не режет распределение посередине.
export const MAX_INTERVAL_MIN = 240

// Меньше этого числа интервалов — не выборка, а совпадение. На боевых данных упаковка
// дала три чистых измерения с медианой 0.3 минуты: показать это как «18 секунд на изделие»
// значило бы соврать увереннее, чем промолчать.
export const MIN_MEASUREMENTS = 10

export type Closure = {
  worker:     string
  workerName: string | null
  station:    string
  at:         number   // ms epoch
}

export type Batch = { worker: string; workerName: string | null; station: string; end: number; items: number }

// Склейка подряд идущих отметок в пачки внутри пары (человек, станция).
export function groupIntoBatches(closures: Closure[], gapSec = BATCH_GAP_SEC): Batch[] {
  const byKey = new Map<string, Closure[]>()
  for (const c of closures) {
    const k = `${c.worker}|${c.station}`
    ;(byKey.get(k) ?? byKey.set(k, []).get(k)!).push(c)
  }
  const out: Batch[] = []
  for (const list of byKey.values()) {
    list.sort((a, b) => a.at - b.at)
    let cur: Batch | null = null
    for (const c of list) {
      if (cur && c.at - cur.end <= gapSec * 1000) {
        cur.end = c.at
        cur.items += 1
      } else {
        if (cur) out.push(cur)
        cur = { worker: c.worker, workerName: c.workerName, station: c.station, end: c.at, items: 1 }
      }
    }
    if (cur) out.push(cur)
  }
  return out
}

export type StationTime = {
  station:      string
  measurements: number    // сколько чистых интервалов легло в оценку
  items:        number
  medianMin:    number | null
  p90Min:       number | null
  droppedDirty: number    // выброшено как загрязнённое чужой станцией
  droppedLong:  number    // выброшено как перерыв/ночь
}

export type WorkerThroughput = {
  worker:       string
  workerName:   string | null
  measurements: number
  items:        number
  medianMin:    number | null
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null
  if (sorted.length === 1) return sorted[0]
  const idx = (sorted.length - 1) * p
  const lo = Math.floor(idx), hi = Math.ceil(idx)
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

// Время на изделие по станциям. Интервал засчитывается, только если в окне
// (конец прошлой пачки; конец этой] тот же человек не закрывал ничего на другой станции.
export function measureStationTime(closures: Closure[], maxIntervalMin = MAX_INTERVAL_MIN): StationTime[] {
  const batches = groupIntoBatches(closures)
  const byWorker = new Map<string, Closure[]>()
  for (const c of closures) (byWorker.get(c.worker) ?? byWorker.set(c.worker, []).get(c.worker)!).push(c)
  for (const list of byWorker.values()) list.sort((a, b) => a.at - b.at)

  const acc = new Map<string, { vals: number[]; items: number; dirty: number; long: number }>()
  const bump = (station: string) =>
    acc.get(station) ?? acc.set(station, { vals: [], items: 0, dirty: 0, long: 0 }).get(station)!

  // Заводим строку КАЖДОЙ станции, где вообще были отметки, — даже если ни одного
  // измеримого интервала не нашлось. Станция, тихо выпавшая из таблицы, читается как
  // «её нет», а на деле она есть и именно она не измеряется; это и есть вывод.
  for (const c of closures) bump(c.station)

  const byKey = new Map<string, Batch[]>()
  for (const b of batches) {
    const k = `${b.worker}|${b.station}`
    ;(byKey.get(k) ?? byKey.set(k, []).get(k)!).push(b)
  }

  for (const list of byKey.values()) {
    list.sort((a, b) => a.end - b.end)
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1], cur = list[i]
      const a = bump(cur.station)
      const mins = (cur.end - prev.end) / 60000
      if (mins > maxIntervalMin) { a.long += 1; continue }
      const others = byWorker.get(cur.worker) ?? []
      const dirty = others.some(c => c.station !== cur.station && c.at > prev.end && c.at <= cur.end)
      if (dirty) { a.dirty += 1; continue }
      a.vals.push(mins / cur.items)
      a.items += cur.items
    }
  }

  return [...acc.entries()].map(([station, a]) => {
    const sorted = [...a.vals].sort((x, y) => x - y)
    return {
      station,
      measurements: a.vals.length,
      items:        a.items,
      medianMin:    percentile(sorted, 0.5),
      p90Min:       percentile(sorted, 0.9),
      droppedDirty: a.dirty,
      droppedLong:  a.long,
    }
  }).sort((x, y) => y.measurements - x.measurements)
}

// Пропускная способность человека: сколько времени уходит на изделие, чем бы он ни
// занимался. Станцию здесь не различаем — поэтому загрязнения нет по определению,
// и для многостаночника это единственная честная мера.
export function measureWorkerThroughput(closures: Closure[], maxIntervalMin = MAX_INTERVAL_MIN): WorkerThroughput[] {
  const flattened = closures.map(c => ({ ...c, station: '*' }))
  const batches = groupIntoBatches(flattened)
  const nameOf = new Map(closures.map(c => [c.worker, c.workerName]))

  const byWorker = new Map<string, Batch[]>()
  for (const b of batches) (byWorker.get(b.worker) ?? byWorker.set(b.worker, []).get(b.worker)!).push(b)

  const out: WorkerThroughput[] = []
  for (const [worker, list] of byWorker) {
    list.sort((a, b) => a.end - b.end)
    const vals: number[] = []
    let items = 0
    for (let i = 1; i < list.length; i++) {
      const mins = (list[i].end - list[i - 1].end) / 60000
      if (mins > maxIntervalMin) continue
      vals.push(mins / list[i].items)
      items += list[i].items
    }
    const sorted = [...vals].sort((x, y) => x - y)
    out.push({ worker, workerName: nameOf.get(worker) ?? null, measurements: vals.length, items, medianMin: percentile(sorted, 0.5) })
  }
  return out.sort((a, b) => b.items - a.items)
}

// Почему по станции нет числа. Пустая клетка без объяснения читается как «сломалось»,
// а здесь у неё есть содержательная причина, и она сама по себе вывод.
export function whyNoData(s: StationTime): string | null {
  if (s.measurements >= MIN_MEASUREMENTS) return null
  if (s.measurements > 0) return `мало замеров: ${s.measurements} из ${MIN_MEASUREMENTS} нужных`
  if (s.droppedDirty > 0) return 'человек в это время работал и на других станциях — интервал измеряет их вместе'
  if (s.droppedLong > 0) return 'между отметками только перерывы и ночи — непрерывной работы не зафиксировано'
  return 'нет отметок за период'
}
