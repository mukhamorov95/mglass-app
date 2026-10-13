import { describe, expect, it } from 'vitest'
import { pbxCallRow, pbxSyncWindow } from '@/lib/pbxCallsStore'

describe('строка звонка АТС для pbx_calls', () => {
  it('исходящий разговор: клиент — набранный номер, внутренний — звонивший', () => {
    const r = pbxCallRow({
      uuid: 'u-1', start_stamp: 1_760_000_000, caller_id_number: '101', destination_number: '89161234567',
      accountcode: 'outbound', user_talk_time: 95, duration: 110, hangup_cause: 'NORMAL_CLEARING',
    })
    expect(r).toMatchObject({
      uuid: 'u-1', direction: 'out', client_phone: '9161234567', ext: '101',
      talk_sec: 95, duration_sec: 110, answered: true, hangup_cause: 'NORMAL_CLEARING',
    })
    expect(r?.started_at).toBe(new Date(1_760_000_000 * 1000).toISOString())
  })

  it('пропущенный входящий: разговора нет, длительность есть', () => {
    const r = pbxCallRow({ uuid: 'u-2', start_stamp: '1760000100', caller_id_number: '+7 (916) 123-45-67', destination_number: '100', accountcode: 'inbound', user_talk_time: 0, duration: 31 })
    expect(r).toMatchObject({ direction: 'in', client_phone: '9161234567', ext: '100', answered: false, talk_sec: 0, duration_sec: 31, hangup_cause: null })
  })

  it('без uuid или времени — не строка', () => {
    expect(pbxCallRow({ start_stamp: 1_760_000_000 })).toBeNull()
    expect(pbxCallRow({ uuid: 'u-3' })).toBeNull()
  })

  it('сырой ответ АТС сохраняется целиком', () => {
    const raw = { uuid: 'u-4', start_stamp: 1_760_000_000, caller_id_number: '100', destination_number: '101', extra_field: 'x' }
    expect(pbxCallRow(raw)?.raw).toBe(raw)
  })
})

describe('окно выгрузки звонков', () => {
  const now = 1_760_100_000
  it('пустая таблица — первый запуск за 30 дней', () => {
    expect(pbxSyncWindow(null, now)).toEqual({ from: now - 30 * 86400, to: now })
  })
  it('от последнего звонка с запасом 2 часа', () => {
    const last = new Date((now - 600) * 1000).toISOString()
    expect(pbxSyncWindow(last, now)).toEqual({ from: now - 600 - 7200, to: now })
  })
  it('после простоя догоняет, но не глубже недели', () => {
    const last = new Date((now - 3 * 86400) * 1000).toISOString()
    expect(pbxSyncWindow(last, now).from).toBe(now - 3 * 86400 - 7200)
    const old = new Date((now - 30 * 86400) * 1000).toISOString()
    expect(pbxSyncWindow(old, now).from).toBe(now - 7 * 86400)
  })
  it('ручная догрузка ?days= — не больше 60 дней', () => {
    expect(pbxSyncWindow(null, now, 30).from).toBe(now - 30 * 86400)
    expect(pbxSyncWindow(null, now, 365).from).toBe(now - 60 * 86400)
  })
})
