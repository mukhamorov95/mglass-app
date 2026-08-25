import { describe, it, expect } from 'vitest'
import { audit, digest, type AuditInput } from '@/lib/accounting/audit'

const EMPTY: AuditInput = {
  today: '2026-08-25',
  unpostedPayments: [], bankRowsNew: [], entries: [], approvedRequests: [],
  openInvoices: [], taxes: [], payrollDebt: [], openMonths: [],
}

const entry = (over: Partial<AuditInput['entries'][number]>): AuditInput['entries'][number] => ({
  id: 1, unit: 'ip', entry_date: '2026-08-20', fund_id: 3, amount: 1000,
  counterparty: 'Ветро', kind: 'out', ...over,
})

describe('проверка бухгалтерии', () => {
  it('на чистых данных молчит', () => {
    expect(audit(EMPTY)).toEqual([])
    expect(digest([])).toBeNull()
  })

  it('непроведённые оплаты старше трёх дней — высокая важность', () => {
    const f = audit({ ...EMPTY, unpostedPayments: [{ amount: 5000, paid_at: '2026-08-10' }] })
    expect(f[0].code).toBe('unposted_payments')
    expect(f[0].severity).toBe('high')
    expect(f[0].amount).toBe(5000)
  })

  it('свежая неразнесённая оплата тревогу не поднимает до высокой', () => {
    const f = audit({ ...EMPTY, unpostedPayments: [{ amount: 5000, paid_at: '2026-08-24' }] })
    expect(f[0].severity).toBe('normal')
  })

  it('ловит задвоенную операцию и считает лишнее', () => {
    const f = audit({ ...EMPTY, entries: [entry({ id: 1 }), entry({ id: 2 }), entry({ id: 3, amount: 700 })] })
    const dup = f.find(x => x.code === 'duplicate_entries')!
    expect(dup.count).toBe(1)
    expect(dup.amount).toBe(1000)   // одна лишняя копия
  })

  it('разные контрагенты в один день дублем не считаются', () => {
    const f = audit({ ...EMPTY, entries: [entry({ counterparty: 'Ветро' }), entry({ counterparty: 'Вандер' })] })
    expect(f.find(x => x.code === 'duplicate_entries')).toBeUndefined()
  })

  it('просроченный налог важнее скорого', () => {
    const f = audit({ ...EMPTY, taxes: [
      { title: 'Аванс УСН', due_date: '2026-08-20', amount: 100000, status: 'planned' },
      { title: 'НДФЛ', due_date: '2026-08-28', amount: 20000, status: 'planned' },
    ] })
    expect(f[0].code).toBe('tax_overdue')
    expect(f.map(x => x.code)).toContain('tax_soon')
  })

  it('оплаченный налог в находки не попадает', () => {
    const f = audit({ ...EMPTY, taxes: [{ title: 'Аванс УСН', due_date: '2026-08-01', amount: 1, status: 'paid' }] })
    expect(f).toEqual([])
  })

  it('всплеск считает только при накопленной статистике фонда', () => {
    const few = audit({ ...EMPTY, entries: [entry({ amount: 100000 }), entry({ id: 2, amount: 100 })] })
    expect(few.find(x => x.code === 'amount_spike')).toBeUndefined()

    const many = audit({ ...EMPTY, entries: [
      ...Array.from({ length: 6 }, (_, i) => entry({ id: i + 10, amount: 1000, counterparty: `к${i}` })),
      entry({ id: 99, amount: 90000, counterparty: 'разовый' }),
    ] })
    expect(many.find(x => x.code === 'amount_spike')?.count).toBe(1)
  })

  it('месяц считается незакрытым только через десять дней после конца', () => {
    const late = audit({ ...EMPTY, openMonths: [{ unit: 'ip', month: '2026-07' }] })
    expect(late.find(x => x.code === 'month_open')).toBeDefined()
    const fresh = audit({ ...EMPTY, openMonths: [{ unit: 'ip', month: '2026-08' }] })
    expect(fresh.find(x => x.code === 'month_open')).toBeUndefined()
  })

  it('в телеграм-сводку мелочи не идут', () => {
    const f = audit({ ...EMPTY,
      entries: [
        ...Array.from({ length: 6 }, (_, i) => entry({ id: i + 10, amount: 1000, counterparty: `к${i}` })),
        entry({ id: 99, amount: 90000, counterparty: 'разовый' }),
      ],
    })
    expect(f.every(x => x.severity === 'low')).toBe(true)
    expect(digest(f)).toBeNull()
  })
})
