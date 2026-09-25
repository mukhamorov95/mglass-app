import { createServiceClient } from '@/lib/supabase-service'
import { amoGetAll } from '@/lib/amocrm'
import { sendMessage, getChannels } from '@/lib/wazzup'
import { buildMessage, normalizePhone, DAILY_LIMIT, MIN_GAP_MS } from '@/lib/reviewMessage'

export { REVIEW_URL, buildMessage, DAILY_LIMIT } from '@/lib/reviewMessage'

// Сбор отзывов после монтажа. Карточка на Картах держится на отзывах, а их 23 при
// сотнях сданных объектов — пишем тем, у кого монтаж свежий в памяти.

// Только «реализовано успешно» и только по closed_at. Фильтр по updated_at брал и
// старые сделки, которые просто редактировали: из 166 найденных 44 были созданы больше
// года назад — человек получил бы «делали вам изделие в сентябре» про шторку 2025 года.
const DONE_STATUS = 142
const PIPELINE = 1654237

type AmoLeadWithContacts = {
  id: number; name: string; price: number; closed_at: number; updated_at: number
  _embedded?: { contacts?: { id: number }[] }
}
type AmoContact = {
  id: number; name: string
  custom_fields_values?: { field_code?: string; values?: { value?: string }[] }[]
}

// Наполнение очереди. Идемпотентно: уникальный индекс не даёт поставить один и тот же
// заказ дважды, поэтому запускать можно сколько угодно раз.
export async function fillQueue(days = 90): Promise<{ found: number; added: number }> {
  const since = Math.floor(Date.now() / 1000) - days * 86400
  const params: Record<string, string> = {
    with: 'contacts',
    'filter[closed_at][from]': String(since),
    'filter[statuses][0][pipeline_id]': String(PIPELINE),
    'filter[statuses][0][status_id]': String(DONE_STATUS),
  }

  const leads = await amoGetAll<AmoLeadWithContacts>('/api/v4/leads', params, 'leads')
  const ids = [...new Set(leads.flatMap(l => (l._embedded?.contacts ?? []).map(c => c.id)))]

  const byId = new Map<number, { name: string; phone: string }>()
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200)
    const p: Record<string, string> = {}
    chunk.forEach((id, k) => { p[`filter[id][${k}]`] = String(id) })
    const contacts = await amoGetAll<AmoContact>('/api/v4/contacts', p, 'contacts')
    for (const c of contacts) {
      const phone = c.custom_fields_values?.find(f => f.field_code === 'PHONE')?.values?.[0]?.value
      if (phone) byId.set(c.id, { name: c.name, phone: normalizePhone(phone) })
    }
  }

  // Один человек — одно сообщение, даже если у него несколько закрытых сделок:
  // две просьбы об отзыве подряд читаются как рассылка, а не как внимание.
  const seen = new Set<string>()
  const rows = leads
    .sort((a, b) => b.closed_at - a.closed_at)
    .flatMap(l => {
      const c = byId.get(l._embedded?.contacts?.[0]?.id ?? -1)
      if (!c?.phone || c.phone.length !== 11 || seen.has(c.phone)) return []
      seen.add(c.phone)
      const doneAt = new Date((l.closed_at || l.updated_at) * 1000).toISOString().slice(0, 10)
      return [{
        amo_lead_id: l.id, client_name: c.name, phone: c.phone,
        order_title: l.name, amount: l.price, done_at: doneAt,
        message_text: buildMessage(c.name, doneAt),
      }]
    })

  const sb = createServiceClient()
  const { data, error } = await sb.from('review_requests')
    .upsert(rows, { onConflict: 'phone,amo_lead_id', ignoreDuplicates: true })
    .select('id')
  if (error) throw new Error(error.message)
  return { found: rows.length, added: data?.length ?? 0 }
}

async function pickChannel(): Promise<string> {
  const explicit = process.env.WAZZUP_REVIEW_CHANNEL_ID
  if (explicit) return explicit
  const list = await getChannels()
  const arr = Array.isArray(list) ? list : (list?.data ?? [])
  const wa = arr.find((c: { transport?: string; state?: string }) => c.transport === 'whatsapp' && c.state === 'active')
  if (!wa) throw new Error('нет активного канала WhatsApp в Wazzup')
  return wa.channelId ?? wa.id
}

// Отправка порции. Возвращает, сколько ушло, — экран показывает это владельцу.
export async function sendBatch(limit = DAILY_LIMIT): Promise<{ sent: number; failed: number }> {
  const sb = createServiceClient()
  const { data: rows, error } = await sb.from('review_requests')
    .select('id, phone, message_text')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(Math.min(limit, DAILY_LIMIT))
  if (error) throw new Error(error.message)

  const channelId = await pickChannel()
  let sent = 0, failed = 0

  for (const row of rows ?? []) {
    try {
      await sendMessage(channelId, row.phone, 'whatsapp', row.message_text)
      await sb.from('review_requests')
        .update({ status: 'sent', sent_at: new Date().toISOString(), channel_id: channelId, chat_id: row.phone, error: null })
        .eq('id', row.id)
      sent++
    } catch (e) {
      await sb.from('review_requests')
        .update({ status: 'failed', error: (e instanceof Error ? e.message : String(e)).slice(0, 300) })
        .eq('id', row.id)
      failed++
    }
    // пауза даже после ошибки: подряд идущие попытки — тот же признак бота
    await new Promise(r => setTimeout(r, MIN_GAP_MS))
  }
  return { sent, failed }
}
