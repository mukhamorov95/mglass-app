// П9 — код на наклейке детали.
//
// Наклейка печатает человеку «Поз.2 · 3/5» — то есть третий физический лист из пяти.
// А в штрихкод до сих пор уходило только MG-<заказ>-<позиция>: у всех пяти листов
// ОДИН И ТОТ ЖЕ код. Отсканировать их по очереди нельзя — первый скан закроет этап,
// остальные ответят «уже отмечено». Человек видит различие, сканер нет.
//
// Учёт пока и правда ведётся по позиции, а не по листу (строка задачи одна на
// позицию — ограничение отмечено в lib/productionStages.ts). Поэтому номер листа
// сейчас НИ НА ЧТО НЕ ВЛИЯЕТ. Но в код он кладётся уже сейчас, потому что наклейки
// клеятся на стекло и живут неделями: когда появится счётчик «сколько из N сделано»,
// перепечатывать всё, что в цеху, будет нельзя.
//
// Чистая логика — ни Supabase, ни React.

export type LabelCode = {
  orderId:   number
  itemIndex: number | null   // null — маршрутный лист заказа целиком
  piece:     number | null   // номер физического листа, 1-based; null — позиция целиком
}

// MG-101            — маршрутный лист заказа
// MG-101-0          — позиция целиком (исторический формат, продолжаем принимать)
// MG-101-0-2        — второй лист позиции
export function formatLabelCode(orderId: number, itemIndex?: number | null, piece?: number | null): string {
  if (itemIndex == null) return `MG-${orderId}`
  if (piece == null) return `MG-${orderId}-${itemIndex}`
  return `MG-${orderId}-${itemIndex}-${piece}`
}

const RE = /^MG-(\d+)(?:-(\d+))?(?:-(\d+))?$/

export function parseLabelCode(raw: string): LabelCode | null {
  const m = raw.trim().toUpperCase().match(RE)
  if (!m) return null
  const orderId = Number(m[1])
  if (!orderId) return null
  return {
    orderId,
    itemIndex: m[2] != null ? Number(m[2]) : null,
    piece:     m[3] != null ? Number(m[3]) : null,
  }
}
