import { createServiceClient } from '@/lib/supabase-service'
import { getRole, OWNER_ROLES } from '@/lib/getRole'
import { redirect } from 'next/navigation'
import { REVIEW_URL, buildMessage, DAILY_LIMIT } from '@/lib/reviewMessage'
import { sentToday, whatsappChannels, type WaChannel } from '@/lib/reviewCampaign'
import { Actions } from './Actions'

// Сбор отзывов после монтажа. Карточка на Картах держится на отзывах: у тех, кто стоит
// выше нас по запросам про душевые, их 92–214, у нас 23 при сотнях сданных объектов.
export const dynamic = 'force-dynamic'

const LABEL: Record<string, string> = {
  pending: 'в очереди', sending: 'в отправке', sent: 'отправлено', failed: 'не ушло',
  skipped: 'пропущено', replied: 'ответили', review_left: 'отзыв оставлен',
}

export default async function ReviewsPage() {
  const role = await getRole()
  if (!role || !OWNER_ROLES.includes(role)) redirect('/')

  const sb = createServiceClient()
  const { data, error } = await sb.from('review_requests').select('status')
  if (error) throw new Error(error.message)
  const counts: Record<string, number> = {}
  for (const r of data ?? []) counts[r.status] = (counts[r.status] ?? 0) + 1

  const left = Math.max(0, DAILY_LIMIT - await sentToday(sb))
  let channels: WaChannel[] = []
  try { channels = await whatsappChannels() } catch { /* Wazzup недоступен — экран покажет «не с чего» */ }

  return (
    <div className="mx-auto max-w-3xl p-6 text-[#111110]">
      <h1 className="text-2xl font-semibold">Просьбы об отзыве</h1>
      <p className="mt-2 text-sm text-[#9a9a95]">
        Клиентам, у кого сделка закрыта успешно за последние 90 дней — один человек, одно сообщение
        не чаще раза в полгода. Пишем только контакту «Заказчик»: не дизайнерам и партнёрам, не их
        клиентам и не тем, у кого была рекламация.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {Object.entries(counts).map(([k, v]) => (
          <div key={k} className="rounded-lg border border-[#e4e4e0] p-3">
            <div className="text-2xl font-semibold">{v}</div>
            <div className="text-xs text-[#9a9a95]">{LABEL[k] ?? k}</div>
          </div>
        ))}
        {Object.keys(counts).length === 0 && (
          <div className="col-span-full text-sm text-[#9a9a95]">Очередь пуста — соберите её.</div>
        )}
      </div>

      <Actions left={left} channels={channels} />

      <p className="mt-4 text-xs text-[#9a9a95]">
        Порция в день — {DAILY_LIMIT} сообщений с паузой между ними. Это не перестраховка:
        WhatsApp блокирует номер за массовую отправку, а вместе с номером уходит вся
        переписка с клиентами. Отправка идёт минутами, вкладку не закрывайте.
      </p>

      <h2 className="mt-8 text-lg font-semibold">Что получит клиент</h2>
      <pre className="mt-2 whitespace-pre-wrap rounded-lg border border-[#e4e4e0] bg-[#f5f5f3] p-4 text-sm">
        {buildMessage('Светлана', new Date().toISOString().slice(0, 10))}
      </pre>
      <p className="mt-2 text-xs text-[#9a9a95]">
        Ссылка ведёт на <a className="underline" href={REVIEW_URL} target="_blank" rel="noreferrer">карточку на Яндекс.Картах</a>
      </p>
    </div>
  )
}
