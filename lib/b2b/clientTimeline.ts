// А20: сквозной контур «менеджер ↔ кабинет клиента». Менеджер должен видеть то же,
// что видел и делал клиент: когда открыл КП, что ответил, что выбрал по доставке,
// согласовал ли чертёж, оплатил ли. Данные уже лежат в notes заказа — здесь они
// собираются в одну ленту. Ничего не пишем и не додумываем: нет события — нет строки.

export type ClientEvent = {
  at: string | null
  icon: string
  text: string
  tone: 'plain' | 'good' | 'warn'
}

type Notes = Record<string, unknown>

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)

export function buildClientTimeline(notes: Notes): ClientEvent[] {
  const out: ClientEvent[] = []

  if (notes.submitted_by_partner_at) {
    out.push({ at: str(notes.submitted_by_partner_at), icon: '🤝', text: 'Клиент отправил заявку из кабинета', tone: 'plain' })
  }
  if (notes.public_token) {
    out.push({ at: null, icon: '🔗', text: 'Выдана ссылка на КП', tone: 'plain' })
  }
  if (notes.public_opened_at) {
    out.push({ at: str(notes.public_opened_at), icon: '👀', text: 'Клиент открыл КП', tone: 'plain' })
  }

  const resp = notes.client_response as { action?: string; comment?: string | null; at?: string } | undefined
  if (resp?.action === 'approve') {
    out.push({ at: resp.at ?? null, icon: '✅', text: `Клиент согласовал КП${resp.comment ? `: «${resp.comment}»` : ''}`, tone: 'good' })
  } else if (resp?.action === 'question') {
    out.push({ at: resp.at ?? null, icon: '❓', text: `Вопрос от клиента${resp.comment ? `: «${resp.comment}»` : ''}`, tone: 'warn' })
  }

  const drawing = notes.drawing_approval as { status?: string; comment?: string | null; at?: string } | undefined
  if (drawing?.status === 'approved') {
    out.push({ at: drawing.at ?? null, icon: '📐', text: 'Клиент согласовал чертёж', tone: 'good' })
  } else if (drawing?.status === 'rework') {
    out.push({ at: drawing.at ?? null, icon: '📐', text: `Клиент вернул чертёж на доработку${drawing.comment ? `: «${drawing.comment}»` : ''}`, tone: 'warn' })
  }

  const delivery = notes.delivery as { method?: string; address?: string | null; status?: string; at?: string; by?: string } | undefined
  if (delivery?.method) {
    const who = delivery.by === 'partner' ? 'Клиент выбрал' : 'Указали'
    const how = delivery.method === 'delivery' ? `доставку${delivery.address ? ` — ${delivery.address}` : ''}` : 'самовывоз'
    out.push({ at: delivery.at ?? null, icon: '🚚', text: `${who} ${how}`, tone: 'plain' })
  }

  if (notes.payment_status === 'paid') {
    out.push({ at: str(notes.paid_at), icon: '💰', text: 'Оплата получена', tone: 'good' })
  } else if (notes.payment_status === 'partial') {
    const pre = Number(notes.prepayment_amount) || 0
    out.push({ at: str(notes.paid_at), icon: '💰', text: `Предоплата${pre > 0 ? ` ${pre.toLocaleString('ru-RU')} ₽` : ''}`, tone: 'plain' })
  }

  if (notes.shipped_date) {
    out.push({ at: str(notes.shipped_date), icon: '📦', text: 'Отгружено клиенту', tone: 'good' })
  }

  const claim = notes.claim as { status?: string; reason?: string } | undefined
  if (claim?.status === 'open') {
    out.push({ at: null, icon: '⚠️', text: `Рекламация: ${claim.reason ?? 'без причины'}`, tone: 'warn' })
  }

  // Хронология: события без даты (ссылка выдана) держим в конце, они справочные.
  return out.sort((a, b) => {
    if (!a.at && !b.at) return 0
    if (!a.at) return 1
    if (!b.at) return -1
    return new Date(a.at).getTime() - new Date(b.at).getTime()
  })
}
