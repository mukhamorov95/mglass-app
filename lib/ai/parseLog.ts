import 'server-only'
import { createServiceClient } from '@/lib/supabase-service'

// Лог разбора чертежа: кто запускал, что вышло.
//
// Заведён 02.09.2026 после вопроса «почему у 49 заказов с чертежами нет ни одного
// диаметра». Ответить по логам было нельзя — их не существовало, и ответ пришлось
// собирать SELECT'ом по последствиям. У кнопки, которой пользуются трое из шести,
// не было ни одной записи о запуске.
//
// Пишем в свою таблицу, а не в `agent_logs`: там autonomous-агенты, и их читают
// два места — лента `/admin/agents` (select *) и сводка `cron/agent-ceo`
// (последние 50 за день). Десяток разборов в день вытеснил бы оттуда то, ради
// чего эти читатели написаны.
//
// Файл не сохраняем — только имя, тип и размер: содержимое чертежа это данные
// клиента, а на вопрос «запускался ли разбор и что нашёл» оно не отвечает.

export { countHoleSignals } from '@/lib/ai/parseSignals'

export type ParseLogRow = {
  route:              'ai/parse-drawing' | 'b2b/parse-pdf'
  userId?:            string | null
  userName?:          string | null
  file?:              { name?: string; type?: string; size?: number } | null
  durationMs:         number
  ok:                 boolean
  itemsFound?:        number
  itemsWithHoles?:    number
  itemsWithDiameter?: number
  error?:             string | null
}

// Лог не должен ломать разбор: у менеджера на экране чертёж, а не наша таблица.
export async function logDrawingParse(row: ParseLogRow): Promise<void> {
  try {
    await createServiceClient().from('drawing_parse_log').insert({
      route:               row.route,
      user_id:             row.userId ?? null,
      user_name:           row.userName ?? null,
      file_name:           row.file?.name ?? null,
      file_type:           row.file?.type ?? null,
      file_size_kb:        row.file?.size ? Math.round(row.file.size / 1024) : null,
      duration_ms:         Math.max(0, Math.round(row.durationMs)),
      ok:                  row.ok,
      items_found:         row.itemsFound ?? 0,
      items_with_holes:    row.itemsWithHoles ?? 0,
      items_with_diameter: row.itemsWithDiameter ?? 0,
      error:               row.error ? String(row.error).slice(0, 500) : null,
    })
  } catch {
    // намеренно молча
  }
}
