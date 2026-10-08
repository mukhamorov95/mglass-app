import { describe, it, expect } from 'vitest'
import {
  canCreateCard, canCloseCard, nextStatus, isOverdue, sortCards, dueLabel, dueFromInput,
  parseCardInput, orderProgress, isMissingTable, boardRecipients, boardMessage,
  canEditCard, parseCardEdit, editSummary, dueToInputs, type BoardCard,
} from '@/lib/shopBoard/model'

const NOW = Date.parse('2026-10-08T09:00:00Z') // 12:00 МСК
const card = (c: Partial<BoardCard> = {}): BoardCard => ({
  id: 1, title: 'Отгрузить 05522', details: null, order_ids: [5522], due_at: null, hot: false, status: 'new',
  created_by: 'owner', created_by_name: 'Влад', taken_by: null, taken_by_name: null, taken_at: null,
  done_by: null, done_by_name: null, done_at: null, closed_by: null, closed_by_name: null, closed_at: null,
  created_at: '2026-10-08T08:00:00Z', ...c,
})

describe('кто ставит и закрывает поручения', () => {
  it('ставят владелец, весь цех и обладатель права shop_board (Дима); менеджер без права — нет', () => {
    expect(canCreateCard('admin')).toBe(true)
    expect(canCreateCard('ceo')).toBe(true)
    expect(canCreateCard('production')).toBe(true)
    expect(canCreateCard('manager', { shop_board: true })).toBe(true)
    expect(canCreateCard('manager')).toBe(false)
    expect(canCreateCard('manager', { shop_board: false })).toBe(false)
    expect(canCreateCard('partner', { shop_board: true })).toBe(false)
    expect(canCreateCard(null)).toBe(false)
  })
  it('закрывает поставивший или владелец', () => {
    expect(canCloseCard(card(), 'owner', 'manager')).toBe(true)
    expect(canCloseCard(card(), 'u2', 'production')).toBe(false)
    expect(canCloseCard(card(), 'u2', 'admin')).toBe(true)
    expect(canCloseCard(card(), null, 'production')).toBe(false)
  })
})

describe('переходы карточки', () => {
  it('взять — только новую; готово — новую или в работе', () => {
    expect(nextStatus(card(), 'take')).toBe('in_progress')
    expect(nextStatus(card({ status: 'in_progress' }), 'take')).toBeNull()
    expect(nextStatus(card(), 'done')).toBe('done')
    expect(nextStatus(card({ status: 'in_progress' }), 'done')).toBe('done')
    expect(nextStatus(card({ status: 'done' }), 'done')).toBeNull()
  })
  it('вернуть — из готово/закрытой: к тому, кто взял, или в новые', () => {
    expect(nextStatus(card({ status: 'done', taken_by: 'u2' }), 'reopen')).toBe('in_progress')
    expect(nextStatus(card({ status: 'closed' }), 'reopen')).toBe('new')
    expect(nextStatus(card({ status: 'new' }), 'reopen')).toBeNull()
  })
  it('закрыть — любую незакрытую', () => {
    expect(nextStatus(card(), 'close')).toBe('closed')
    expect(nextStatus(card({ status: 'closed' }), 'close')).toBeNull()
  })
})

describe('срок', () => {
  it('сорван — только у незакрытой и не готовой', () => {
    expect(isOverdue(card({ due_at: '2026-10-08T08:00:00Z' }), NOW)).toBe(true)
    expect(isOverdue(card({ due_at: '2026-10-08T08:00:00Z', status: 'done' }), NOW)).toBe(false)
    expect(isOverdue(card({ due_at: '2026-10-09T15:00:00Z' }), NOW)).toBe(false)
    expect(isOverdue(card(), NOW)).toBe(false)
  })
  it('подпись — по Москве', () => {
    expect(dueLabel(card({ due_at: '2026-10-08T15:00:00Z' }), NOW)).toBe('сегодня до 18:00')
    expect(dueLabel(card({ due_at: '2026-10-09T15:00:00Z' }), NOW)).toBe('до 09.10 18:00')
    expect(dueLabel(card({ due_at: '2026-10-08T06:00:00Z' }), NOW)).toBe('сорван срок 09:00')
    expect(dueLabel(card({ due_at: '2026-09-30T15:00:00Z' }), NOW)).toBe('просрочено на 7 дн.')
    expect(dueLabel(card(), NOW)).toBeNull()
  })
  it('из формы: дата + время по Москве, без времени — 18:00', () => {
    expect(dueFromInput('2026-10-09')).toBe('2026-10-09T15:00:00.000Z')
    expect(dueFromInput('2026-10-09', '10:30')).toBe('2026-10-09T07:30:00.000Z')
    expect(dueFromInput('09.10.2026')).toBeNull()
  })
})

describe('порядок на табло', () => {
  it('горящие, потом сорванные, потом по сроку, без срока — в конце', () => {
    const cards = [
      card({ id: 1, due_at: '2026-10-10T15:00:00Z' }),
      card({ id: 2 }),
      card({ id: 3, due_at: '2026-10-07T15:00:00Z' }),
      card({ id: 4, hot: true, due_at: '2026-10-12T15:00:00Z' }),
      card({ id: 5, due_at: '2026-10-09T15:00:00Z' }),
    ]
    expect(sortCards(cards, NOW).map(c => c.id)).toEqual([4, 3, 5, 1, 2])
  })
})

describe('вход формы', () => {
  it('нормальное поручение', () => {
    expect(parseCardInput({ title: '  Отгрузить завтра ', order_ids: [5522, '5522', 0, 'x'], due_at: '2026-10-09T15:00:00Z', hot: true }))
      .toEqual({ title: 'Отгрузить завтра', details: null, order_ids: [5522], due_at: '2026-10-09T15:00:00.000Z', hot: true })
  })
  it('ошибки словами', () => {
    expect(parseCardInput({ title: ' ' })).toEqual({ error: 'Напишите, что сделать' })
    expect(parseCardInput({ title: 'x'.repeat(201) })).toHaveProperty('error')
    expect(parseCardInput({ title: 'ок', due_at: 'завтра' })).toEqual({ error: 'Срок не распознан' })
    expect(parseCardInput({ title: 'ок', order_ids: Array.from({ length: 11 }, (_, i) => i + 1) })).toHaveProperty('error')
  })
})

describe('прогресс заказа по отметкам цеха', () => {
  it('этапы в порядке цеха, закрыто из всего', () => {
    expect(orderProgress([
      { stage_key: 'packaging', status: 'queued' }, { stage_key: 'cutting', status: 'done' },
      { stage_key: 'cutting', status: 'queued' }, { stage_key: 'tempering', status: 'in_progress' },
    ])).toEqual([
      { key: 'cutting', label: 'Резка', done: 1, total: 2 },
      { key: 'tempering', label: 'Закалка', done: 0, total: 1 },
      { key: 'packaging', label: 'Упаковка', done: 0, total: 1 },
    ])
  })
  it('последняя отметка этапа — кто и когда', () => {
    expect(orderProgress([
      { stage_key: 'cutting', status: 'done', completed_at: '2026-10-07T10:00:00Z', completed_by_name: 'Никита' },
      { stage_key: 'cutting', status: 'done', completed_at: '2026-10-08T06:00:00Z', completed_by_name: 'Эльзат' },
    ])).toEqual([{ key: 'cutting', label: 'Резка', done: 2, total: 2, at: '2026-10-08T06:00:00Z', by: 'Эльзат' }])
  })
})

describe('SQL табло не применён', () => {
  it('узнаём «таблицы нет» по коду и тексту', () => {
    expect(isMissingTable({ code: 'PGRST205', message: "Could not find the table 'public.shop_board_cards'" })).toBe(true)
    expect(isMissingTable({ code: '42P01', message: 'relation does not exist' })).toBe(true)
    expect(isMissingTable({ code: '23505', message: 'duplicate key' })).toBe(false)
    expect(isMissingTable(null)).toBe(false)
  })
})

describe('уведомления табло', () => {
  const people = { shop: ['s1', 's2'], owners: ['owner'], boardUsers: ['dima'], orderManagers: ['m1', 's1'] }
  it('новое — цеху, владельцу, Диме, менеджерам заказа; без повторов и без автора', () => {
    expect(boardRecipients('created', card({ created_by: 'dima' }), 'dima', people).sort())
      .toEqual(['m1', 'owner', 's1', 's2'])
  })
  it('взял/готово/вернул — поставившему и менеджерам заказа', () => {
    expect(boardRecipients('taken', card(), 's2', people).sort()).toEqual(['m1', 'owner', 's1'])
    expect(boardRecipients('done', card(), 'owner', people).sort()).toEqual(['m1', 's1'])
  })
  it('комментарий — поставившему и взявшему; закрыто — взявшему', () => {
    expect(boardRecipients('comment', card({ taken_by: 's2' }), 'm1', people).sort()).toEqual(['owner', 's2'])
    expect(boardRecipients('comment', card({ taken_by: 's2' }), 's2', people)).toEqual(['owner'])
    expect(boardRecipients('closed', card({ taken_by: 's2' }), 'owner', people)).toEqual(['s2'])
    expect(boardRecipients('closed', card(), 'owner', people)).toEqual([])
  })
  it('текст экранирует то, что написали люди', () => {
    const t = boardMessage('created', card({ title: 'Отгрузить <b>завтра</b> & всё', due_at: '2026-10-09T09:00:00Z', hot: true }),
      'Влад', [{ ref: '05522', client: 'ГлассДекор' }], NOW)
    expect(t).toContain('🔥 Отгрузить &lt;b&gt;завтра&lt;/b&gt; &amp; всё')
    expect(t).toContain('Заказ: 05522 ГлассДекор')
    expect(t).toContain('Срок: до 09.10 12:00')
    expect(boardMessage('comment', card(), 'Никита', [], NOW, 'закалка <в 10>')).toContain('закалка &lt;в 10&gt;')
  })
})

describe('правка «Горит» и срока', () => {
  it('правит поставивший или владелец', () => {
    expect(canEditCard(card(), 'owner', 'manager')).toBe(true)
    expect(canEditCard(card(), 'u2', 'admin')).toBe(true)
    expect(canEditCard(card(), 'u2', 'production')).toBe(false)
  })
  it('вход: горит, срок, снять срок; пустое — ошибка', () => {
    expect(parseCardEdit({ hot: true })).toEqual({ hot: true })
    expect(parseCardEdit({ due_at: '2026-10-10T15:00:00Z' })).toEqual({ due_at: '2026-10-10T15:00:00.000Z' })
    expect(parseCardEdit({ due_at: null })).toEqual({ due_at: null })
    expect(parseCardEdit({})).toEqual({ error: 'Нечего менять' })
    expect(parseCardEdit({ hot: 'да' })).toHaveProperty('error')
    expect(parseCardEdit({ due_at: 'завтра' })).toEqual({ error: 'Срок не распознан' })
  })
  it('что изменилось — словами, по Москве; без изменений — пусто', () => {
    const c = card({ hot: false, due_at: '2026-10-09T09:00:00Z' })
    expect(editSummary(c, { hot: true })).toBe('🔥 горит')
    expect(editSummary(c, { due_at: '2026-10-10T15:00:00Z' })).toBe('срок: до 10.10 18:00 (было 09.10 12:00)')
    expect(editSummary(c, { hot: true, due_at: null })).toBe('🔥 горит, срок снят')
    expect(editSummary(c, { hot: false, due_at: '2026-10-09T09:00:00.000Z' })).toBe('')
    expect(editSummary(card(), { due_at: '2026-10-10T15:00:00Z' })).toBe('срок: до 10.10 18:00')
  })
  it('срок в поля формы и обратно', () => {
    expect(dueToInputs('2026-10-09T09:00:00Z')).toEqual({ date: '2026-10-09', time: '12:00' })
    expect(dueFromInput(dueToInputs('2026-10-09T09:00:00Z').date, dueToInputs('2026-10-09T09:00:00Z').time)).toBe('2026-10-09T09:00:00.000Z')
    expect(dueToInputs(null)).toEqual({ date: '', time: '' })
  })
  it('уведомление о правке — поставившему, взявшему, менеджерам заказа', () => {
    const people = { shop: ['s1'], owners: ['owner'], boardUsers: [], orderManagers: ['m1'] }
    expect(boardRecipients('edited', card({ taken_by: 's1' }), 'owner', people).sort()).toEqual(['m1', 's1'])
    expect(boardMessage('edited', card({ hot: true }), 'Влад', [], NOW, '🔥 горит')).toContain('✏️ Влад изменил: 🔥 Отгрузить 05522\n🔥 горит')
  })
})
