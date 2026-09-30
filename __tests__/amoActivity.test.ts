import { describe, it, expect } from 'vitest'
import {
  buildAmoActivity, callKind, replyEpisodes, dropAutoReplies, mskDayStart, mskDay, fmtTime, median,
  type AmoActivityEvent, type AmoCallNote,
} from '@/lib/amoActivity'

const ALINA = 8272804
const YANA = 1593673
const day = mskDayStart('2026-09-21')
const at = (hh: number, mm = 0) => day + hh * 3600 + mm * 60

const ev = (type: string, created_by: number, created_at: number, extra: Partial<AmoActivityEvent> = {}): AmoActivityEvent =>
  ({ type, created_by, created_at, entity_id: 100, entity_type: 'lead', ...extra })
const chat = (type: 'incoming_chat_message' | 'outgoing_chat_message', by: number, ts: number, talk: number, lead = 100, origin = 'com.wazzup24.wz') =>
  ev(type, by, ts, { entity_id: lead, value_after: [{ message: { talk_id: talk, origin } }] })
const call = (id: number, note_type: string, by: number, ts: number, status: number, duration = 60): AmoCallNote =>
  ({ id, note_type, created_by: by, created_at: ts, params: { call_status: status, duration } })

const build = (events: AmoActivityEvent[], callNotes: AmoCallNote[] = [], resp: [number, number][] = [[100, ALINA]], created: [number, number][] = []) =>
  buildAmoActivity({
    from: day, to: day + 86400,
    users: [{ id: ALINA, name: 'Алина' }, { id: YANA, name: 'Яна' }],
    events, callNotes, leadResponsible: new Map(resp), leadCreatedAt: new Map(created),
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

describe('клиент остался ждать', () => {
  it('написал в будний вечер после последнего действия ответственного — ждал до утра', () => {
    const r = build([
      ev('task_completed', ALINA, at(16, 15)),
      chat('incoming_chat_message', 0, at(17, 15), 9),
      chat('outgoing_chat_message', 0, at(9 + 24, 30), 9),
      chat('incoming_chat_message', 0, at(12, 0), 10),
      chat('outgoing_chat_message', ALINA, at(12, 5), 10),
    ])
    expect(r.managers[0].days[0].leftWaiting).toBe(1)
  })
  it('ответили тем же вечером — не ждал', () => {
    const r = build([
      ev('task_completed', ALINA, at(16, 15)),
      chat('incoming_chat_message', 0, at(17, 15), 9),
      chat('outgoing_chat_message', 0, at(18, 0), 9),
    ])
    expect(r.managers[0].days[0].leftWaiting).toBe(0)
  })
})

// Живые случаи 23–29.09: сделка 39507355 (беседа 12129) — приветствие Wazzup в ту же секунду,
// что и сообщение клиента, и Salesbot через 5 с после создания сделки; сделка 39509941
// (беседа 12131) — Salesbot через 2 с после создания, клиент написал позже.
describe('автоответ робота — не ответ', () => {
  const kept = (events: AmoActivityEvent[], created: [number, number][] = []) =>
    dropAutoReplies(events, new Map(created)).map(e => `${e.type === 'incoming_chat_message' ? 'in' : 'out'}@${e.created_at - day}`)

  it('приветствие в ту же секунду, что и первое сообщение клиента, — убираем, в каком бы порядке amo их ни отдал', () => {
    const t = at(10, 17) + 6
    expect(kept([chat('outgoing_chat_message', 0, t, 1), chat('incoming_chat_message', 0, t, 1)])).toEqual([`in@${t - day}`])
    expect(kept([chat('incoming_chat_message', 0, t, 1), chat('outgoing_chat_message', 0, t, 1)])).toEqual([`in@${t - day}`])
  })

  it('Salesbot через секунды после создания сделки — убираем, даже если клиент ещё не писал', () => {
    const created = at(14, 43) + 27
    expect(kept([chat('outgoing_chat_message', 0, created + 2, 2)], [[100, created]])).toEqual([])
    expect(kept([chat('outgoing_chat_message', 0, created + 31, 2)], [[100, created]])).toHaveLength(1)
  })

  it('первое сообщение после часа тишины открывает беседу заново — приветствие на него тоже автоответ', () => {
    const r = kept([
      chat('outgoing_chat_message', ALINA, at(9, 0), 3),
      chat('incoming_chat_message', 0, at(10, 12), 3),
      chat('outgoing_chat_message', 0, at(10, 12), 3),
    ])
    expect(r).toEqual([`out@${at(9, 0) - day}`, `in@${at(10, 12) - day}`])
  })

  it('быстрый ответ без автора посреди переписки — менеджер с телефона, не трогаем', () => {
    const r = kept([
      chat('incoming_chat_message', 0, at(12, 0), 4),
      chat('outgoing_chat_message', 0, at(12, 5), 4),
      chat('incoming_chat_message', 0, at(12, 20), 4),
      chat('outgoing_chat_message', 0, at(12, 20) + 1, 4),
      chat('incoming_chat_message', 0, at(12, 40), 4),
      chat('outgoing_chat_message', 0, at(12, 40) + 12, 4),
    ])
    expect(r).toHaveLength(6)
  })

  it('с автором, позже 30 секунд и в Авито (там пишет ИИ-продавец) — это ответы', () => {
    const t = at(11, 0)
    expect(kept([chat('incoming_chat_message', 0, t, 5), chat('outgoing_chat_message', ALINA, t + 1, 5)])).toHaveLength(2)
    expect(kept([chat('incoming_chat_message', 0, t, 6), chat('outgoing_chat_message', 0, t + 31, 6)])).toHaveLength(2)
    expect(kept([chat('incoming_chat_message', 0, t, 7, 100, 'avito'), chat('outgoing_chat_message', 0, t + 10, 7, 100, 'avito')])).toHaveLength(2)
  })

  it('звонки и чужие беседы правило не задевает', () => {
    const t = at(11, 0)
    const r = kept([
      chat('incoming_chat_message', 0, t, 8),
      ev('outgoing_call', ALINA, t + 5),
      chat('outgoing_chat_message', 0, t + 5, 9, 200),
    ])
    expect(r).toHaveLength(3)
  })

  it('ответ клиенту меряется до менеджера, автоответ не идёт ни в медиану, ни в «+N»', () => {
    const t = at(10, 17) + 6
    const r = build([
      chat('outgoing_chat_message', 0, t, 12),
      chat('incoming_chat_message', 0, t, 12),
      chat('outgoing_chat_message', 0, t + 7, 12),
      chat('outgoing_chat_message', ALINA, at(10, 55) + 42, 12),
    ], [], [[100, ALINA]], [[100, t + 2]])
    const d = r.managers[0].days[0]
    expect(d.replyMinutes).toEqual([39])
    expect(d.messagesNoAuthor).toBe(0)
    expect(d.messagesOwn).toBe(1)
    expect(r.autoReplies).toBe(2)
  })

  it('клиенту ответил только робот — «без ответа»', () => {
    const t = at(15, 0)
    const r = build([chat('incoming_chat_message', 0, t, 13), chat('outgoing_chat_message', 0, t + 3, 13)])
    const d = r.managers[0].days[0]
    expect(d.unanswered).toBe(1)
    expect(d.replyMinutes).toEqual([])
  })
})
