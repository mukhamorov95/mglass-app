import { describe, it, expect } from 'vitest'
import {
  buildAmoActivity, callKind, replyEpisodes, mskDayStart, mskDay, fmtTime, median,
  type AmoActivityEvent, type AmoCallNote,
} from '@/lib/amoActivity'

const ALINA = 8272804
const YANA = 1593673
const day = mskDayStart('2026-09-21')
const at = (hh: number, mm = 0) => day + hh * 3600 + mm * 60

const ev = (type: string, created_by: number, created_at: number, extra: Partial<AmoActivityEvent> = {}): AmoActivityEvent =>
  ({ type, created_by, created_at, entity_id: 100, entity_type: 'lead', ...extra })
const chat = (type: 'incoming_chat_message' | 'outgoing_chat_message', by: number, ts: number, talk: number, lead = 100) =>
  ev(type, by, ts, { entity_id: lead, value_after: [{ message: { talk_id: talk } }] })
const call = (id: number, note_type: string, by: number, ts: number, status: number, duration = 60): AmoCallNote =>
  ({ id, note_type, created_by: by, created_at: ts, params: { call_status: status, duration } })

const build = (events: AmoActivityEvent[], callNotes: AmoCallNote[] = [], resp: [number, number][] = [[100, ALINA]]) =>
  buildAmoActivity({
    from: day, to: day + 86400,
    users: [{ id: ALINA, name: 'Алина' }, { id: YANA, name: 'Яна' }],
    events, callNotes, leadResponsible: new Map(resp),
  })

describe('время по Москве', () => {
  it('сутки начинаются в 00:00 МСК, а не UTC', () => {
    expect(mskDay(day)).toBe('2026-09-21')
    expect(mskDay(day - 1)).toBe('2026-09-20')
    expect(fmtTime(at(9, 5))).toBe('09:05')
  })
})

describe('звонки', () => {
  it('разговор состоялся только при call_status 4', () => {
    expect(callKind(call(1, 'call_in', ALINA, 0, 4))).toBe('in_ok')
    expect(callKind(call(1, 'call_in', ALINA, 0, 6))).toBe('in_missed')
    expect(callKind(call(1, 'call_out', ALINA, 0, 4))).toBe('out_ok')
    expect(callKind(call(1, 'call_out', ALINA, 0, 6))).toBe('out_fail')
  })

  it('пропущенный входящий не двигает начало дня и не считается действием', () => {
    const r = build(
      [
        ev('incoming_call', ALINA, at(8, 0), { value_after: [{ note: { id: 1 } }] }),
        ev('task_completed', ALINA, at(10, 0)),
      ],
      [call(1, 'call_in', ALINA, at(8, 0), 6, 25)],
    )
    const d = r.managers.find(m => m.userId === ALINA)!.days[0]
    expect(fmtTime(d.firstAt)).toBe('10:00')
    expect(d.actions).toBe(1)
    expect(d.callsInMissed).toBe(1)
    expect(d.talkSeconds).toBe(0)
  })

  it('принятый входящий — действие, длительность идёт в минуты разговора', () => {
    const r = build(
      [ev('incoming_call', ALINA, at(9, 30), { value_after: [{ note: { id: 2 } }] })],
      [call(2, 'call_in', ALINA, at(9, 30), 4, 120)],
    )
    const d = r.managers[0].days[0]
    expect(d.callsInAnswered).toBe(1)
    expect(d.actions).toBe(1)
    expect(d.talkSeconds).toBe(120)
  })
})

describe('сообщения без автора', () => {
  it('засчитываются ответственному отдельно и не двигают его рабочее окно', () => {
    const r = build([
      chat('outgoing_chat_message', 0, at(7, 0), 1),
      chat('outgoing_chat_message', ALINA, at(10, 0), 1),
    ])
    const d = r.managers[0].days[0]
    expect(d.messagesOwn).toBe(1)
    expect(d.messagesNoAuthor).toBe(1)
    expect(d.hourlyNoAuthor[7]).toBe(1)
    expect(fmtTime(d.firstAt)).toBe('10:00')
  })

  it('без ответственного — в «не распределено», а не кому-то наугад', () => {
    const r = build([chat('outgoing_chat_message', 0, at(12), 1, 999)])
    expect(r.noAuthorUnassigned).toBe(1)
    expect(r.managers).toHaveLength(0)
  })
})

describe('что не считается действием', () => {
  it('ночная связка сделка↔контакт под учёткой менеджера — интеграция, не человек', () => {
    const r = build([ev('entity_linked', YANA, at(3, 42)), ev('lead_status_changed', YANA, at(10, 10))])
    const d = r.managers.find(m => m.userId === YANA)!.days[0]
    expect(fmtTime(d.firstAt)).toBe('10:10')
    expect(d.actions).toBe(1)
    expect(d.cardsMoved).toBe(1)
  })
})

describe('рабочее окно', () => {
  it('первое, последнее, часы с действиями и самая длинная пауза', () => {
    const r = build([
      ev('task_completed', ALINA, at(9, 50)),
      ev('outgoing_chat_message', ALINA, at(10, 5)),
      ev('task_deadline_changed', ALINA, at(13, 5)),
      ev('lead_status_changed', ALINA, at(16, 15)),
    ])
    const m = r.managers[0]
    const d = m.days[0]
    expect(fmtTime(d.firstAt)).toBe('09:50')
    expect(fmtTime(d.lastAt)).toBe('16:15')
    expect(d.activeHours).toBe(4)
    expect(d.longestPauseMin).toBe(190)
    expect(d.tasksCompleted).toBe(1)
    expect(d.tasksPostponed).toBe(1)
    expect(m.workDays).toBe(1)
    expect(m.medianStartMin).toBe(9 * 60 + 50)
  })
})

describe('ответ клиенту', () => {
  it('ожидание — от первого сообщения клиента до первого исходящего, от кого угодно', () => {
    const eps = replyEpisodes([
      chat('incoming_chat_message', 0, at(11, 0), 5),
      chat('incoming_chat_message', 0, at(11, 2), 5),
      chat('outgoing_chat_message', 0, at(11, 10), 5),
      chat('incoming_chat_message', 0, at(18, 0), 5),
    ])
    expect(eps).toHaveLength(2)
    expect((eps[0].replyAt! - eps[0].startAt) / 60).toBe(10)
    expect(eps[1].replyAt).toBeNull()
  })

  it('ночные сообщения в медиану ответа не идут', () => {
    const r = build([
      chat('incoming_chat_message', 0, at(23, 0), 7),
      chat('incoming_chat_message', 0, at(12, 0), 8),
      chat('outgoing_chat_message', ALINA, at(12, 4), 8),
    ])
    const m = r.managers[0]
    expect(m.days[0].replyMinutes).toEqual([4])
    expect(m.days[0].unanswered).toBe(0)
    expect(m.days[0].clientMessages).toBe(2)
  })

  it('медиана честная на чётном числе', () => {
    expect(median([1, 3])).toBe(2)
    expect(median([])).toBeNull()
  })
})
