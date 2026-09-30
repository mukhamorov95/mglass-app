import { describe, it, expect } from 'vitest'
import { measureActorFrom, denyAction, type MeasureRow } from '@/lib/measure/access'

const actor = (role: string, extra: { canViewAllClients?: boolean; managerWorkspace?: boolean } = {}) =>
  measureActorFrom({ userId: `u-${role}`, name: role, role, ...extra })

const row = (p: Partial<MeasureRow> = {}): MeasureRow => ({ id: 1, status: 'new', manager_id: 'u-manager', measurer_id: null, ...p })

describe('measureActorFrom — кто вообще работает с замерами', () => {
  it('круги по ролям', () => {
    expect(actor('admin')?.scope).toBe('all')
    expect(actor('office')?.scope).toBe('all')
    expect(actor('measurer')?.scope).toBe('measurer')
    expect(actor('manager')?.scope).toBe('own')
    expect(actor('manager', { canViewAllClients: true })?.scope).toBe('all')
    expect(actor('logist')?.scope).toBe('own')
  })
  it('без доступа к замерам — null', () => {
    expect(actor('partner')).toBeNull()
    expect(actor('production')).toBeNull()
    expect(actor('buyer')).toBeNull()
  })
  it('закупщик с менеджерским контуром — как менеджер', () => {
    const a = actor('buyer', { managerWorkspace: true })
    expect(a?.scope).toBe('own')
    expect(a?.canCreate).toBe(true)
  })
  it('создавать заявки: менеджер и офис да, замерщик и логист нет', () => {
    expect(actor('manager')?.canCreate).toBe(true)
    expect(actor('office')?.canCreate).toBe(true)
    expect(actor('measurer')?.canCreate).toBe(false)
    expect(actor('logist')?.canCreate).toBe(false)
  })
})

describe('denyAction', () => {
  it('выплату отмечает только владелец и только по выполненному', () => {
    expect(denyAction(actor('manager')!, row({ status: 'done' }), 'fee_paid')).not.toBeNull()
    expect(denyAction(actor('measurer')!, row({ status: 'done', measurer_id: 'u-measurer' }), 'fee_paid')).not.toBeNull()
    expect(denyAction(actor('office')!, row({ status: 'done' }), 'fee_paid')).not.toBeNull()
    expect(denyAction(actor('admin')!, row({ status: 'scheduled' }), 'fee_paid')).not.toBeNull()
    expect(denyAction(actor('admin')!, row({ status: 'done' }), 'fee_paid')).toBeNull()
  })

  it('замерщик берёт из пула, но не чужой назначенный', () => {
    const m = actor('measurer')!
    expect(denyAction(m, row(), 'schedule')).toBeNull()
    expect(denyAction(m, row({ status: 'scheduled', measurer_id: 'u-other' }), 'schedule')).not.toBeNull()
    expect(denyAction(m, row({ status: 'scheduled', measurer_id: 'u-measurer' }), 'schedule')).toBeNull()
  })

  it('менеджер назначает и отменяет только свои заявки', () => {
    const own = actor('manager')!
    expect(denyAction(own, row(), 'schedule')).toBeNull()
    expect(denyAction(own, row(), 'cancel')).toBeNull()
    expect(denyAction(own, row({ manager_id: 'u-other' }), 'schedule')).not.toBeNull()
    expect(denyAction(own, row({ manager_id: 'u-other' }), 'cancel')).not.toBeNull()
  })

  it('«выполнен» ставит замерщик этого замера, офис или владелец — не менеджер', () => {
    const r = row({ status: 'scheduled', measurer_id: 'u-measurer' })
    expect(denyAction(actor('measurer')!, r, 'done')).toBeNull()
    expect(denyAction(actor('manager')!, r, 'done')).not.toBeNull()
    expect(denyAction(actor('office')!, r, 'done')).toBeNull()
    expect(denyAction(actor('measurer')!, row({ status: 'scheduled', measurer_id: 'u-other' }), 'done')).not.toBeNull()
  })

  it('файл к замеру: замерщик замера и менеджер заявки; чужой менеджер — нет', () => {
    const r = row({ status: 'scheduled', measurer_id: 'u-measurer' })
    expect(denyAction(actor('measurer')!, r, 'attach')).toBeNull()
    expect(denyAction(actor('manager')!, r, 'attach')).toBeNull()
    expect(denyAction(actor('manager')!, row({ manager_id: 'u-other' }), 'attach')).not.toBeNull()
  })

  it('логист ничего не меняет', () => {
    const l = actor('logist')!
    for (const a of ['schedule', 'unassign', 'done', 'issue', 'cancel', 'attach'] as const) {
      expect(denyAction(l, row({ status: 'scheduled', measurer_id: 'u-measurer' }), a)).not.toBeNull()
    }
  })
})
