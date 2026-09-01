// Что показывать на экране отгрузки и в каком порядке.
//
// Упаковано не значит отгружено: заказ ждёт на складе, пока за ним не приедут.
// Экран отвечает на два вопроса — «что лежит готовое» и «где заказ, за которым
// приехали прямо сейчас».

export type ShipRow = {
  id:          number
  number:      string
  client:      string
  packagedAt:  string | null   // когда упаковали
  shippedAt:   string | null   // когда отгрузили
  tasksTotal:  number
  tasksDone:   number
}

// Готов к отгрузке: упакован либо весь цех по нему закрыт, и ещё не отгружен.
// Второе условие нужно потому, что отметку «Упакован» ставят не всегда, а
// закрытые задачи означают то же самое.
export function isReadyToShip(r: ShipRow): boolean {
  if (r.shippedAt) return false
  if (r.packagedAt) return true
  return r.tasksTotal > 0 && r.tasksDone === r.tasksTotal
}

// Сначала те, что ждут дольше всех: заказ, пролежавший три недели, важнее
// вчерашнего. Без даты упаковки — в конец, о них известно меньше.
export function sortByWaiting(rows: ShipRow[]): ShipRow[] {
  return [...rows].sort((a, b) => {
    const ax = a.packagedAt ?? ''
    const bx = b.packagedAt ?? ''
    if (!ax && !bx) return a.id - b.id
    if (!ax) return 1
    if (!bx) return -1
    return ax.localeCompare(bx)
  })
}

// Сколько дней заказ лежит упакованным. null — если дата упаковки неизвестна.
export function daysWaiting(r: ShipRow, now: Date): number | null {
  if (!r.packagedAt) return null
  const d = new Date(r.packagedAt)
  if (isNaN(d.getTime())) return null
  return Math.max(0, Math.floor((now.getTime() - d.getTime()) / 86_400_000))
}

// Поиск по номеру заказа и по клиенту: за заказом приезжают, называя либо номер,
// либо «я от такого-то».
export function matchesQuery(r: ShipRow, q: string): boolean {
  const s = q.trim().toLowerCase()
  if (!s) return true
  return r.number.toLowerCase().includes(s) || r.client.toLowerCase().includes(s)
}
