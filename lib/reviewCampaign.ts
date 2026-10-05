import { createServiceClient } from '@/lib/supabase-service'
import { amoGetAll } from '@/lib/amocrm'
import { sendMessage, getChannels } from '@/lib/wazzup'
import { buildMessage, mskMidnightIso, DAILY_LIMIT, MIN_GAP_MS } from '@/lib/reviewMessage'
import { selectRecipients, type ReviewLead, type ReviewContact, type SkipReason } from '@/lib/reviewEligibility'

export { REVIEW_URL, buildMessage, DAILY_LIMIT } from '@/lib/reviewMessage'

// Сбор отзывов после монтажа. Карточка на Картах держится на отзывах, а их 23 при
// сотнях сданных объектов — пишем тем, у кого монтаж свежий в памяти.

// Только «реализовано успешно» и только по closed_at. Фильтр по updated_at брал и
// старые сделки, которые просто редактировали: из 166 найденных 44 были созданы больше
// года назад — человек получил бы «делали вам изделие в сентябре» про шторку 2025 года.
const DONE_STATUS = 142
const PIPELINE = 1654237

// Тому же человеку повторно — не раньше чем через полгода, даже по новому заказу
const REPEAT_AFTER_DAYS = 180

// Функция живёт 300 с (maxDuration маршрута), между сообщениями 40 с — за один вызов
// уходит 5–6 сообщений, остальное экран досылает следующими вызовами.
const TIME_BUDGET_MS = 240_000

// Наполнение очереди. Идемпотентно: повторный запуск не добавит ни ту же сделку
// (уникальный индекс), ни того же человека (askedBefore).
export async function fillQueue(days = 90): Promise<{ found: number; added: number; skipped: Partial<Record<SkipReason, number>> }> {
  const since = Math.floor(Date.now() / 1000) - days * 86400
  // Путь без /api/v4: amoGet добавляет его сам. С префиксом запрос уходил на
  // /api/v4/api/v4/leads, получал 404, а 404 amoGet отдаёт как «пусто».
  const leads = await amoGetAll<ReviewLead>('/leads', {
    with: 'contacts',
    'filter[closed_at][from]': String(since),
    'filter[statuses][0][pipeline_id]': String(PIPELINE),
    'filter[statuses][0][status_id]': String(DONE_STATUS),
  }, 'leads')
  // За 90 дней закрывается ~30 сделок в месяц: ноль — сломанный запрос, а не правда
  if (!leads.length) throw new Error(`AmoCRM не вернул ни одной успешной сделки за ${days} дней — похоже на сбой запроса`)

  // Все контакты сделки, а не первый: клиент бывает вторым после дизайнера
  const ids = [...new Set(leads.flatMap(l => (l._embedded?.contacts ?? []).map(c => c.id)))]
  const contacts: ReviewContact[] = []
  for (let i = 0; i < ids.length; i += 200) {
    const p: Record<string, string> = {}
    ids.slice(i, i + 200).forEach((id, k) => { p[`filter[id][${k}]`] = String(id) })
    contacts.push(...await amoGetAll<ReviewContact>('/contacts', p, 'contacts'))
  }

  const sb = createServiceClient()
  const { data: prev, error: prevErr } = await sb.from('review_requests')
    .select('phone')
    .gte('created_at', new Date(Date.now() - REPEAT_AFTER_DAYS * 86400_000).toISOString())
  if (prevErr) throw new Error(prevErr.message)

  const { rows, skipped } = selectRecipients(leads, contacts, new Set((prev ?? []).map(r => r.phone)))
  if (!rows.length) return { found: leads.length, added: 0, skipped }

  const { data, error } = await sb.from('review_requests')
    .upsert(rows, { onConflict: 'phone,amo_lead_id', ignoreDuplicates: true })
    .select('id')
  if (error) throw new Error(error.message)
  return { found: leads.length, added: data?.length ?? 0, skipped }
}

export type WaChannel = { channelId: string; name: string; tail: string }

// Канал выбирает владелец на экране: у компании два рабочих номера WhatsApp, и с
// незнакомого клиенту номера сообщение чаще уходит в «спам» — а за жалобы банят номер.
export async function whatsappChannels(): Promise<WaChannel[]> {
  const list = await getChannels()
  const arr: { channelId?: string; transport?: string; state?: string; name?: string; plainId?: string }[] =
    Array.isArray(list) ? list : (list?.data ?? [])
  return arr
    .filter(c => c.transport === 'whatsapp' && c.state === 'active' && c.channelId)
    .map(c => ({ channelId: c.channelId!, name: c.name ?? '', tail: String(c.plainId ?? '').slice(-4) }))
}

type Sb = ReturnType<typeof createServiceClient>

// sending тоже считается: строка взята в отправку и могла уйти
export async function sentToday(sb: Sb): Promise<number> {
  const { count, error } = await sb.from('review_requests')
    .select('id', { count: 'exact', head: true })
    .in('status', ['sent', 'sending'])
    .gte('sent_at', mskMidnightIso())
  if (error) throw new Error(error.message)
  return count ?? 0
}

// Отправка порции. Каждую строку сначала забираем (pending → sending) условным UPDATE:
// вторая вкладка или повтор после таймаута получат 0 строк и не напишут человеку дважды.
// Строка, застрявшая в sending, обратно в очередь не возвращается — ушло ли сообщение,
// неизвестно, и повторная просьба хуже пропущенной.
export async function sendBatch(channelId: string, limit: number): Promise<{ sent: number; failed: number; pending: number; left: number }> {
  if (!(await whatsappChannels()).some(c => c.channelId === channelId)) {
    throw new Error('этот номер не найден среди активных WhatsApp в Wazzup')
  }
  const sb = createServiceClient()
  const started = Date.now()
  let sent = 0, failed = 0

  while (sent + failed < limit && Date.now() - started + MIN_GAP_MS <= TIME_BUDGET_MS) {
    if (await sentToday(sb) >= DAILY_LIMIT) break

    const { data: next, error } = await sb.from('review_requests')
      .select('id, phone, client_name, done_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(1)
    if (error) throw new Error(error.message)
    const row = next?.[0]
    if (!row) break

    const { data: claimed, error: claimErr } = await sb.from('review_requests')
      .update({ status: 'sending', sent_at: new Date().toISOString(), channel_id: channelId })
      .eq('id', row.id).eq('status', 'pending')
      .select('id')
    if (claimErr) throw new Error(claimErr.message)
    if (!claimed?.length) continue

    const text = buildMessage(row.client_name, row.done_at)
    let sendErr = ''
    try {
      await sendMessage(channelId, row.phone, 'whatsapp', text)
    } catch (e) {
      sendErr = (e instanceof Error ? e.message : String(e)).slice(0, 300)
    }
    const { error: markErr } = await sb.from('review_requests')
      .update(sendErr
        ? { status: 'failed', error: sendErr }
        : { status: 'sent', sent_at: new Date().toISOString(), chat_id: row.phone, message_text: text, error: null })
      .eq('id', row.id)
    if (sendErr) failed++; else sent++
    // Сообщение ушло, а отметка нет — строка останется в sending и не уйдёт повторно
    if (markErr) throw new Error(`отправлено ${sent}, но отметка не записалась: ${markErr.message}`)

    // пауза даже после ошибки: подряд идущие попытки — тот же признак бота
    await new Promise(r => setTimeout(r, MIN_GAP_MS))
  }

  const { count: pending, error: pendErr } = await sb.from('review_requests')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')
  if (pendErr) throw new Error(pendErr.message)
  return { sent, failed, pending: pending ?? 0, left: Math.max(0, DAILY_LIMIT - await sentToday(sb)) }
}
