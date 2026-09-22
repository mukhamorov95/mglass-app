import { describe, it, expect } from 'vitest'
import { buildAmoResults, stageKey, stageId, type StatusEvent } from '@/lib/amoResults'

const SALES = 1654237
const QUAL = 8060186
const ALINA = 8272804
const SEMEN = 13677554
const monday = Date.parse('2026-09-21T00:00:00Z') / 1000 - 3 * 3600
const at = (h: number, m = 0) => monday + h * 3600 + m * 60

const stageNames = new Map([
  [stageId(SALES, 25002553), 'замер назначен'],
  [stageId(SALES, 49559185), 'Кп отправлено'],
  [stageId(SALES, 25002559), 'Счет выставлен - ждем оплату'],
  [stageId(SALES, 80871986), 'ОПлата получена - Проверка чертежей'],
  [stageId(SALES, 42158179), 'счёт Оплачен'],
  [stageId(SALES, 142), 'реализовано успешно'],
  [stageId(SALES, 143), 'не реализовано'],
  [stageId(QUAL, 142), 'Замер запланирован'],
])
const moved = (by: number, lead: number, status: number, ts = at(12), pipeline = SALES, from?: number): StatusEvent =>
  ({
    entity_id: lead, created_by: by, created_at: ts,
    value_after: [{ lead_status: { id: status, pipeline_id: pipeline } }],
    value_before: from ? [{ lead_status: { id: from, pipeline_id: pipeline } }] : null,
  })

const build = (over: Partial<Parameters<typeof buildAmoResults>[0]>) => buildAmoResults({
  from: monday, to: monday + 7 * 86400, now: at(20),
  users: [{ id: ALINA, name: 'Алина' }, { id: SEMEN, name: 'Семён' }],
  stageNames, statusEvents: [], newLeads: [], paidLeads: [], contacts: [], openTasks: [],
  ...over,
})

describe('этапы по названию', () => {
  it('ловит этапы воронки «Продажи» в любом регистре и с ё', () => {
    expect(stageKey('замер назначен', 1)).toBe('measure')
    expect(stageKey('Кп отправлено', 1)).toBe('kp')
    expect(stageKey('Счет выставлен - ждем оплату', 1)).toBe('invoice')
    expect(stageKey('ОПлата получена - Проверка чертежей', 1)).toBe('paid')
    expect(stageKey('счёт Оплачен', 1)).toBe('paid')
    expect(stageKey('Согласование после замера', 1)).toBeNull()
  })
  it('системный 142 в «Квалификации» — это замер, а не продажа', () => {
    expect(stageKey('Замер запланирован', 142)).toBe('measure')
    expect(stageKey('реализовано успешно', 142)).toBe('won')
    expect(stageKey('что угодно', 143)).toBe('lost')
  })
})

describe('результат менеджера', () => {
  it('этап засчитывается тому, кто перевёл, по разу на сделку', () => {
    const r = build({
      statusEvents: [
        moved(ALINA, 1, 25002553), moved(ALINA, 1, 25002553, at(13)), moved(ALINA, 1, 49559185),
        moved(SEMEN, 2, 142, at(12), QUAL),
      ],
    })
    const alina = r.managers.find(m => m.userId === ALINA)!
    expect(alina.advanced.measure).toBe(1)
    expect(alina.advanced.kp).toBe(1)
    expect(r.managers.find(m => m.userId === SEMEN)!.advanced.measure).toBe(1)
  })

  it('перевод между этапами оплаты — не новая оплата; откат назад — не продвижение', () => {
    const r = build({
      statusEvents: [
        moved(ALINA, 7, 42158179, at(12), SALES, 80871986),
        moved(ALINA, 8, 25002553, at(12), SALES, 49559185),
        moved(ALINA, 9, 80871986, at(12), SALES, 25002559),
      ],
    })
    const a = r.managers[0].advanced
    expect(a.paid).toBe(1)
    expect(a.measure).toBe(0)
  })

  it('оплата и бюджет — по ответственному сейчас', () => {
    const r = build({
      paidLeads: [
        { id: 5, responsible_user_id: ALINA, created_at: at(1), status_id: 80871986, pipeline_id: SALES, price: 250000 },
        { id: 6, responsible_user_id: ALINA, created_at: at(1), status_id: 42158179, pipeline_id: SALES, price: null },
      ],
    })
    const alina = r.managers[0]
    expect(alina.paidDeals).toBe(2)
    expect(alina.paidBudget).toBe(250000)
  })

  it('новая заявка днём без исходящего по карточке — «без контакта»; ночная не считается', () => {
    const r = build({
      newLeads: [
        { id: 10, responsible_user_id: SEMEN, created_at: at(10), status_id: 1, pipeline_id: SALES },
        { id: 11, responsible_user_id: SEMEN, created_at: at(11), status_id: 143, pipeline_id: SALES },
        { id: 12, responsible_user_id: SEMEN, created_at: at(23), status_id: 1, pipeline_id: SALES },
      ],
      contacts: [
        { entity_id: 11, entity_type: 'lead', created_at: at(11, 4) },
        { entity_id: 10, entity_type: 'lead', created_at: at(9) },
      ],
    })
    const s = r.managers[0]
    expect(s.leadsReceived).toBe(3)
    expect(s.leadsDaytime).toBe(2)
    expect(s.leadsNoContact).toBe(1)
    expect(s.firstContactMedianMin).toBe(4)
    expect(s.lostOfReceived).toBe(1)
  })

  it('просроченные задачи и старше 30 дней', () => {
    const r = build({
      openTasks: [
        { responsible_user_id: SEMEN, complete_till: at(21) },
        { responsible_user_id: SEMEN, complete_till: at(19) },
        { responsible_user_id: SEMEN, complete_till: at(20) - 31 * 86400 },
      ],
    })
    const s = r.managers[0]
    expect(s.tasksOpen).toBe(3)
    expect(s.tasksOverdue).toBe(2)
    expect(s.tasksOverdue30).toBe(1)
  })
})
