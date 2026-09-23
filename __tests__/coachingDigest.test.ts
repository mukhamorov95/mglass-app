import { describe, it, expect } from 'vitest'
import { telegramDigest } from '@/lib/coaching/digest'
import type { Coaching, FocusItem } from '@/lib/coaching/rules'

const f = (kind: FocusItem['kind'], title: string): FocusItem =>
  ({ kind, title, detail: '', url: null, at: 1, weight: 1, leadId: null })
const c = (over: Partial<Coaching> = {}): Coaching => ({
  amoUserId: 1, name: 'Айжан', computedAt: 1, focus: [], focusMore: 0, habit: null, wins: [],
  results: { days: 90, leads: 0, paidDeals: 0, paidBudget: 0, per100: null }, ...over,
})

describe('напоминание в Telegram', () => {
  it('считает поводы по видам и зовёт открыть список', () => {
    const text = telegramDigest(c({
      focus: [f('missed_call', 'Перезвони +7 926 439-34-79'), f('waiting_chat', 'Ответь в чате: «А»'), f('waiting_chat', 'Ответь в чате: «Б»'), f('new_lead', 'Свяжись с новой заявкой «В»')],
      focusMore: 2,
      habit: { key: 'left_waiting', title: 'Не оставлять клиентов на вечер', fact: '', target: '', action: 'Последние 15 минут дня — чаты и пропущенные.' },
    }), 'https://app')!
    expect(text).toContain('Сегодня 6 поводов: 1 перезвонить, 2 ответить в чате, 1 новая заявка и другие.')
    expect(text).toContain('• Перезвони +7 926 439-34-79')
    expect(text).toContain('…ещё 1 в списке')
    expect(text).toContain('Привычка недели:')
    expect(text).toContain('Открыть список: https://app')
  })

  it('«<» в названии сделки экранируется — иначе Telegram отвергнет всё сообщение', () => {
    const text = telegramDigest(c({ focus: [f('waiting_chat', 'Ответь в чате: «Стекло <8 мм> & рама»')] }), 'https://app')!
    expect(text).toContain('&lt;8 мм&gt; &amp; рама')
    expect(text).not.toContain('<8 мм>')
  })

  it('нечего сказать — не пишем', () => {
    expect(telegramDigest(c(), 'https://app')).toBeNull()
  })
})
