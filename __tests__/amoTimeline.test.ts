import { describe, it, expect } from 'vitest'
import { buildTimeline } from '@/lib/amoTimeline'
import type { AmoActivityEvent, AmoCallNote } from '@/lib/amoActivity'

const SEMEN = 13677554, YANA = 1593673
const T = Math.floor(Date.parse('2026-09-23T06:54:00Z') / 1000) // 09:54 МСК
const ev = (type: string, over: Partial<AmoActivityEvent> = {}, valueAfter?: unknown, valueBefore?: unknown): AmoActivityEvent =>
  ({
    type, created_by: SEMEN, created_at: T, entity_id: 1, entity_type: 'lead',
    ...(valueAfter ? { value_after: [valueAfter] as never } : {}),
    ...(valueBefore ? { value_before: [valueBefore] as never } : {}),
    ...over,
  })
const call = (id: number, note_type: string, status: number, duration: number): AmoCallNote =>
  ({ id, note_type, created_by: SEMEN, created_at: T, params: { call_status: status, duration } })

const base = {
  userId: SEMEN, from: T - 3600, to: T + 3600,
  names: new Map([['lead:1', { name: 'Душевая под ключ', url: 'https://amo/leads/detail/1' }]]),
  stageNames: new Map([['9:100', 'Продажи → Проработка'], ['9:200', 'Продажи → Кп отправлено']]),
  users: new Map([[SEMEN, 'Семён'], [YANA, 'Яна']]),
  fieldNames: new Map([[7, 'Тип изделия']]),
  missedNoteIds: new Set<number>(),
  callNotes: [] as AmoCallNote[],
}

describe('лента действий', () => {
  it('переводы, сообщения, звонки и поля — по-русски, с карточкой', () => {
    const items = buildTimeline({
      ...base,
      events: [
        ev('lead_status_changed', {}, { lead_status: { id: 200, pipeline_id: 9 } }, { lead_status: { id: 100, pipeline_id: 9 } }),
        ev('outgoing_chat_message', { created_at: T + 60 }, { message: { origin: 'avito' } }),
        ev('outgoing_call', { created_at: T + 120 }, { note: { id: 5 } }),
        ev('custom_field_7_value_changed', { created_at: T + 180 }, { custom_field_value: { field_id: 7, text: 'Душевая перегородка' } }),
      ],
      callNotes: [call(5, 'call_out', 4, 123)],
    })
    expect(items.map(i => `${i.title}${i.detail ? ' — ' + i.detail : ''}`)).toEqual([
      'Передвинул сделку — Продажи → Проработка → Продажи → Кп отправлено',
      'Написал клиенту — Avito',
      'Позвонил клиенту — разговор 2:03',
      'Заполнил поле «Тип изделия» — Душевая перегородка',
    ])
    expect(items[0].entity).toBe('Душевая под ключ')
    expect(items[0].url).toBe('https://amo/leads/detail/1')
  })

  it('назначил карточку на себя — «взял на себя», а не «передал — → Семён»', () => {
    const [mine, other] = buildTimeline({
      ...base,
      events: [
        ev('entity_responsible_changed', {}, { responsible_user: { id: SEMEN } }),
        ev('entity_responsible_changed', { created_at: T + 60 }, { responsible_user: { id: YANA } }),
      ],
    })
    expect(mine).toMatchObject({ title: 'Взял карточку на себя', detail: '' })
    expect(other).toMatchObject({ title: 'Передал карточку', detail: 'Яна' })
  })

  it('чужие действия и непринятый входящий в ленту не попадают', () => {
    const items = buildTimeline({
      ...base,
      missedNoteIds: new Set([9]),
      events: [
        ev('incoming_call', {}, { note: { id: 9 } }),
        ev('outgoing_chat_message', { created_by: YANA, created_at: T + 60 }, { message: { origin: 'avito' } }),
        ev('incoming_chat_message', { created_by: 0, created_at: T + 120 }),
      ],
    })
    expect(items).toHaveLength(0)
  })
})
