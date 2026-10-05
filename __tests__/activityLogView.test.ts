import { describe as group, it, expect } from 'vitest'
import { describe, fmtValue, type LogEntry } from '@/lib/activityLogView'

const e = (patch: Partial<LogEntry>): LogEntry => ({
  id: 1, user_id: null, user_name: 'Вера', action: 'row.update', entity_type: 'crm_sales', entity_id: '11523',
  details: null, created_at: '2026-10-05T17:31:00Z', ...patch,
})
// ru-RU делит разряды неразрывным пробелом — сравниваем как обычный.
const n = <T,>(x: T): T => JSON.parse(JSON.stringify(x).replace(/\u00a0/g, ' '))
const sales = new Map([[11523, { order_no: '0944-3', client: 'Юлия Горбачева' }]])

group('журнал действий — запись триггера по-русски', () => {
  it('правка маржи: статья, номер заказа, было → стало', () => {
    const d = describe(e({ entity_type: 'margin_edits', entity_id: '11523 · glass', details: { changes: { value: [12500, 13000] } } }), sales)
    expect(n(d)).toEqual({ verb: 'изменено', tone: 'edit', place: 'Маржа', object: 'заказ 0944-3 · Юлия Горбачева', changes: [{ what: 'стекло', before: '12 500', after: '13 000' }] })
  })
  it('внесение и удаление правки маржи — «из книги» и обратно', () => {
    expect(n(describe(e({ action: 'row.insert', entity_type: 'margin_edits', entity_id: '11523 · installer', details: { row: { value: 9000 } } }), sales).changes))
      .toEqual([{ what: 'монтажник', before: 'из книги', after: '9 000' }])
    expect(describe(e({ action: 'row.delete', entity_type: 'margin_edits', entity_id: '11523 · closed', details: { row: { value: 1 } } }), sales))
      .toMatchObject({ tone: 'del', changes: [{ what: 'закрыт', before: 'да', after: 'снова из книги' }] })
  })
  it('продажа: статус и сумма по-русски, объект — заказ и клиент', () => {
    const d = describe(e({ details: { changes: { status: ['open', 'closed'], amount: [100000, 120000] }, row: { order_no: '0944-3', client: 'Юлия Горбачева' } } }))
    expect(d.object).toBe('заказ 0944-3 · Юлия Горбачева')
    expect(n(d.changes)).toEqual([{ what: 'статус', before: 'в работе', after: 'закрыт' }, { what: 'сумма', before: '100 000', after: '120 000' }])
  })
  it('удалённая строка показывает, что было; тяжёлая колонка — словом', () => {
    const del = describe(e({ action: 'row.delete', entity_type: 'payments', details: { row: { amount: 50000 } } }))
    expect(n(del)).toMatchObject({ verb: 'удалено', tone: 'del', place: 'Платежи', changes: [{ what: 'сумма', before: '50 000', after: '' }] })
    expect(describe(e({ entity_type: 'commercial_proposals', details: { changes: { items: 'изменено' } } })).changes)
      .toEqual([{ what: 'позиции', before: '', after: 'изменено' }])
  })
  it('значения: пусто, да/нет, длинный текст', () => {
    expect([fmtValue(null), fmtValue(true), fmtValue('x'.repeat(90)).length]).toEqual(['—', 'да', 81])
  })
  it('права пользователя — только изменённые ключи, по-русски', () => {
    const was = { see_b2b: true, manager_workspace: true, b2b_client_scope: 'all_clients' }
    const d = describe(e({ entity_type: 'users', details: { changes: { permissions: [was, { ...was, margin_edit: true }] }, row: { name: 'Вера' } } }))
    expect(d).toMatchObject({ place: 'Пользователи и права', object: 'Вера', changes: [{ what: 'права · Маржа', before: '—', after: 'да' }] })
  })
})
