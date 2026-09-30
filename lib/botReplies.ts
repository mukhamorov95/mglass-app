import 'server-only'
import { createServiceClient } from '@/lib/supabase-service'

// Когда ИИ-продавец Авито «Иван» писал клиентам — по его журналу crm_lead_events («БОТ: …»:
// ответы, дожимы, догон). Нужен метрикам amo: там его сообщение приходит без автора, как от
// менеджера с телефона. Отдаёт только моменты времени — вызывают его сборщики метрик за
// маршрутами с ролью и кроны со своим секретом.

const PAGE = 1000

export async function fetchBotSentAt(from: number, to: number): Promise<number[]> {
  const svc = createServiceClient()
  const out: number[] = []
  for (let page = 0; ; page++) {
    const { data, error } = await svc.from('crm_lead_events').select('created_at')
      .eq('kind', 'message').like('text', 'БОТ:%')
      .gte('created_at', new Date((from - 60) * 1000).toISOString())
      .lt('created_at', new Date((to + 60) * 1000).toISOString())
      .order('id').range(page * PAGE, page * PAGE + PAGE - 1)
    if (error) throw new Error(`Журнал бота Авито не прочитан: ${error.message}`)
    for (const r of data as { created_at: string }[]) out.push(Date.parse(r.created_at) / 1000)
    if (data.length < PAGE) break
  }
  return out.sort((a, b) => a - b)
}
