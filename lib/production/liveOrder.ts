import { isShipped } from '@/lib/b2b/todayPriorities'
import { parseNotes } from '@/lib/orderFlags'

// Заказ, по которому цеху ещё есть что делать: не в архиве и не уехал. Задачи архивных
// и отгруженных заказов в очередях и счётчиках цеха — не работа, а шум: на 07.10 их было
// 59 из 1380 открытых, и они же не давали очереди сойтись с тем, что лежит в цеху.
export function isLiveShopOrder(o: { archived_at?: string | null; notes?: unknown }): boolean {
  if (o.archived_at) return false
  return !isShipped(parseNotes(o.notes))
}
