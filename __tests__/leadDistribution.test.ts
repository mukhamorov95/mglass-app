import { describe, it, expect } from 'vitest'
import {
  decide, knownOwner, normalizePhone, overload, phoneFromLeadName, shiftState,
  type Seller, type SellerState,
} from '@/lib/leadDistribution/rules'

const msk = (s: string) => Date.parse(`${s}:00+03:00`) / 1000
const WED = (hm: string) => msk(`2026-09-30T${hm}`)
const SAT = (hm: string) => msk(`2026-10-03T${hm}`)

const seller = (over: Partial<Seller> = {}): Seller => ({
  id: 1, name: 'Яна', startsOn: null, workFrom: '09:00:00', workTo: '18:00:00', workDays: [1, 2, 3, 4, 5], ...over,
})
const st = (id: number, name: string, over: Partial<SellerState> = {}): SellerState => ({
  id, name, onShift: true, offReason: null, load: { waiting: 0, missed: 0, untouched: 0 }, todayCount: 0, lastAssignedAt: null, ...over,
})

describe('кто на смене', () => {
  it('будни в часы графика — да; до и после — нет', () => {
    expect(shiftState(seller(), WED('09:30'), null).onShift).toBe(true)
    expect(shiftState(seller(), WED('08:59'), null)).toEqual({ onShift: false, why: 'вне смены' })
    expect(shiftState(seller(), WED('18:00'), WED('09:05'))).toEqual({ onShift: false, why: 'вне смены' })
  })

  it('час смены без действий в amo — «нет на месте»; с действием — на смене', () => {
    expect(shiftState(seller(), WED('10:01'), null)).toEqual({ onShift: false, why: 'нет в amo с начала смены' })
    expect(shiftState(seller(), WED('10:01'), WED('09:40')).onShift).toBe(true)
  })

  it('до даты выхода и в выходной по графику — нет', () => {
    expect(shiftState(seller({ startsOn: '2026-10-01' }), WED('12:00'), WED('09:10')).why).toBe('ещё не вышел на работу')
    expect(shiftState(seller({ workDays: [1, 2, 4, 5] }), WED('12:00'), WED('09:10')).why).toBe('выходной по графику')
  })

  it('суббота без субботы в графике — дежурит тот, кто уже действовал в amo', () => {
    expect(shiftState(seller(), SAT('11:00'), SAT('10:20')).onShift).toBe(true)
    expect(shiftState(seller(), SAT('11:00'), null)).toEqual({ onShift: false, why: 'суббота, не дежурит' })
  })
})

describe('перегруз', () => {
  it('пороги 6 / 3 / 3', () => {
    expect(overload({ waiting: 5, missed: 2, untouched: 2 })).toEqual([])
    expect(overload({ waiting: 6, missed: 3, untouched: 3 })).toEqual([
      '6 клиент(а) ждут ответа', '3 пропущенных без перезвона', '3 новых заявок без касания',
    ])
  })
})

describe('кому отдать заявку', () => {
  const team = () => [st(1, 'Яна', { todayCount: 2 }), st(2, 'Семён', { todayCount: 1 }), st(3, 'Айжан', { todayCount: 1, lastAssignedAt: WED('11:00') })]

  it('по очереди — у кого меньше за сегодня, при равенстве — кто дольше не получал', () => {
    const d = decide({ known: null, sellers: team() })
    expect(d).toMatchObject({ status: 'decided', rule: 'rotation', userId: 2, name: 'Семён' })
  })

  it('перегруженного пропускаем и пишем почему', () => {
    const s = team(); s[1].load = { waiting: 8, missed: 0, untouched: 0 }
    const d = decide({ known: null, sellers: s })
    expect(d).toMatchObject({ status: 'decided', userId: 3 })
    expect(d.reason).toContain('пропущен(а): Семён — 8 клиент(а) ждут ответа')
  })

  it('знакомый клиент — своему менеджеру, если тот на смене, даже загруженному', () => {
    const s = team(); s[0].load = { waiting: 5, missed: 3, untouched: 0 }
    expect(decide({ known: { userId: 1, name: 'Яна' }, sellers: s })).toMatchObject({ rule: 'known_client', userId: 1, reason: 'клиент Яна' })
  })

  it('менеджер знакомого клиента не на смене — в очередь с пометкой', () => {
    const s = team(); s[0] = { ...s[0], onShift: false, offReason: 'выходной по графику' }
    const d = decide({ known: { userId: 1, name: 'Яна' }, sellers: s })
    expect(d).toMatchObject({ rule: 'rotation', userId: 2 })
    expect(d.reason).toContain('клиент Яна — выходной по графику')
  })

  it('никого нет на смене — ждёт начала смены', () => {
    const s = team().map(x => ({ ...x, onShift: false, offReason: 'вне смены' }))
    expect(decide({ known: null, sellers: s })).toMatchObject({ status: 'deferred' })
  })

  it('перегружены все — наименее загруженному и флаг владельцу', () => {
    const s = team().map((x, i) => ({ ...x, load: { waiting: 6 + i, missed: 0, untouched: 0 } }))
    expect(decide({ known: null, sellers: s })).toMatchObject({ rule: 'least_loaded', userId: 1, allOverloaded: true })
  })
})

describe('чей клиент', () => {
  const now = WED('12:00')
  const sellers = new Set([1, 2])

  it('самая свежая сделка с продавцом; свежие сделки АТС (младше суток) не в счёт, если их нет в журнале', () => {
    const others = [
      { id: 10, created_at: now - 40 * 86400, responsible_user_id: 2 },
      { id: 11, created_at: now - 3 * 86400, responsible_user_id: 1 },
      { id: 12, created_at: now - 600, responsible_user_id: 2 },
    ]
    expect(knownOwner(99, others, new Map(), sellers, now)).toBe(1)
    expect(knownOwner(99, others, new Map([[12, 2]]), sellers, now)).toBe(2)
  })

  it('владелец и сопровождение — не «свой менеджер»', () => {
    expect(knownOwner(99, [{ id: 10, created_at: now - 5 * 86400, responsible_user_id: 777 }], new Map(), sellers, now)).toBeNull()
  })

  it('номер из имени сделки АТС и нормализация', () => {
    expect(phoneFromLeadName('Пропущенный 79853140687 (79311097535 - 79311097535)')).toBe('79853140687')
    expect(phoneFromLeadName('Душевая 1200')).toBeNull()
    expect(normalizePhone('+7 (985) 314-06-87')).toBe('79853140687')
    expect(normalizePhone('8 985 314 06 87')).toBe('79853140687')
  })
})
