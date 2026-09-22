import { describe, it, expect } from 'vitest'
import { normalizePbxCall, summarizePbx, extFromRecordLink, type PbxCall } from '@/lib/pbxCalls'
import { summarizeWazzupOutgoing, sameName } from '@/lib/wazzupOutgoing'

const T = 1790000000
const call = (over: Partial<PbxCall>): PbxCall =>
  ({ uuid: Math.random().toString(36), startedAt: T, direction: 'in', clientPhone: '9261112233', ext: '103', talkSec: 60, answered: true, ...over })

describe('разбор звонка АТС', () => {
  it('входящий: клиент — звонивший, внутренний — куда пришёл', () => {
    const c = normalizePbxCall({ uuid: 'u1', start_stamp: T, accountcode: 'inbound', caller_id_number: '79261112233', destination_number: '103', user_talk_time: 42 })!
    expect(c).toMatchObject({ direction: 'in', clientPhone: '9261112233', ext: '103', talkSec: 42, answered: true })
  })
  it('исходящий без accountcode — по форме номеров', () => {
    const c = normalizePbxCall({ uuid: 'u2', start_stamp: String(T), caller_id_number: '102', destination_number: '+7 (926) 111-22-33', billsec: 0 })!
    expect(c).toMatchObject({ direction: 'out', clientPhone: '9261112233', ext: '102', answered: false })
  })
  it('без id или времени — не звонок', () => {
    expect(normalizePbxCall({ start_stamp: T })).toBeNull()
    expect(normalizePbxCall({ uuid: 'x' })).toBeNull()
  })
})

describe('сводка АТС', () => {
  it('пропущенный: перезвонили за 2 часа / не перезвонили вовсе', () => {
    const s = summarizePbx([
      call({ uuid: 'a', clientPhone: '9000000001', answered: false, talkSec: 0, ext: null }),
      call({ uuid: 'b', clientPhone: '9000000001', direction: 'out', startedAt: T + 1800, ext: '102' }),
      call({ uuid: 'c', clientPhone: '9000000002', answered: false, talkSec: 0, ext: null }),
      call({ uuid: 'd', clientPhone: '9000000003', ext: '103' }),
    ], new Map([['102', 11127302], ['103', 8272804]]), new Set(['d']), T + 86400)
    expect(s).toMatchObject({ inbound: 3, inboundAnswered: 1, inboundMissed: 2, missedClients: 2, missedCalledBack2h: 1, missedNeverCalledBack: 1, notInAmo: 1 })
    expect(s.missedNotCalledBackList).toEqual([{ at: T, phone: '9000000002', attempts: 1 }])
    expect(s.byUser.find(u => u.ext === '103')).toMatchObject({ userId: 8272804, inboundAnswered: 1 })
  })
  it('три звонка подряд без ответа — один клиент с тремя попытками', () => {
    const s = summarizePbx([
      call({ uuid: 'x1', clientPhone: '9264393479', answered: false, talkSec: 0, startedAt: T }),
      call({ uuid: 'x2', clientPhone: '9264393479', answered: false, talkSec: 0, startedAt: T + 180 }),
      call({ uuid: 'x3', clientPhone: '9264393479', answered: false, talkSec: 0, startedAt: T + 300 }),
      call({ uuid: 'y1', clientPhone: '9650002381', answered: false, talkSec: 0, startedAt: T + 400 }),
      call({ uuid: 'y2', clientPhone: '9650002381', direction: 'out', startedAt: T + 9000, ext: '101' }),
      call({ uuid: 'y3', clientPhone: '9650002381', answered: false, talkSec: 0, startedAt: T + 20000 }),
    ], new Map(), new Set(), T + 86400)
    expect(s).toMatchObject({ inboundMissed: 5, missedClients: 3, missedCalledBack2h: 0, missedNeverCalledBack: 2 })
    expect(s.missedNotCalledBackList).toEqual([
      { at: T + 20000, phone: '9650002381', attempts: 1 },
      { at: T + 300, phone: '9264393479', attempts: 3 },
    ])
  })

  it('внутренние звонки между сотрудниками не считаются', () => {
    expect(summarizePbx([call({ direction: 'local' })], new Map(), new Set(), T + 1).calls).toBe(0)
  })
})

describe('внутренний номер из ссылки на запись amo', () => {
  const link = (json: object) =>
    `https://pbx12210.onpbx.ru/download_amocrm/${Buffer.from(JSON.stringify(json)).toString('base64')}_sig+x=/rec.mp3`
  it('входящий — из «t», исходящий — из «f»', () => {
    expect(extFromRecordLink(link({ f: '79264393479', t: '103' }))).toBe('103')
    expect(extFromRecordLink(link({ f: '102', t: '79261112233' }))).toBe('102')
    expect(extFromRecordLink('https://example.com/x.mp3')).toBeNull()
  })
})

describe('авторы Wazzup', () => {
  it('считает по авторам и отдельно без автора', () => {
    const w = summarizeWazzupOutgoing([
      { author_name: 'Алина', sent_at: '2026-09-22T07:00:00Z' },
      { author_name: 'Алина', sent_at: '2026-09-22T08:00:00Z' },
      { author_name: null, sent_at: '2026-09-22T08:00:00Z' },
    ])
    expect(w).toMatchObject({ total: 3, noAuthor: 1 })
    expect(w.authors[0]).toMatchObject({ name: 'Алина', total: 2, byDay: { '2026-09-22': 2 } })
  })
  it('имя Wazzup и amo — по первому слову, ё = е', () => {
    expect(sameName('Семен Иванов', 'Семён')).toBe(true)
    expect(sameName('Яна', 'Алина')).toBe(false)
  })
})
