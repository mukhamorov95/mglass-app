import { describe, it, expect } from 'vitest'
import { partnerProgress, partnerDeadline, isLaunched } from '@/lib/partner/orderProgress'

// Формы notes — как в проде 07.10 (см. __tests__/b2b/stageDone.test.ts).
const OLD_SHIPPED = {
  status: 'confirmed',
  stages: { printed: true, material_ordered: true, cut: true, edge: true, drilled: true, tempering: true, packed: true, shipped: true },
}

describe('кабинет партнёра — ход заказа', () => {
  it('старый отгруженный заказ (true без дат) — «Отгружен», 100 %', () => {
    const p = partnerProgress({ launched_at: '2025-11-02' }, OLD_SHIPPED)
    expect(p.lane).toBe('shipped')
    expect(p.progressPct).toBe(100)
    expect(p.stage).toBe('Отгружен')
    expect(p.timeline.every(t => t.state === 'done')).toBe(true)
    expect(p.timeline.every(t => t.date === null)).toBe(true)
  })

  it('свежий заказ с датами цеха — процент по дальнему шагу, этап — следующий', () => {
    const p = partnerProgress({ launched_at: '2026-10-01' }, {
      status: 'sent', launched_at: '2026-10-01',
      stages: { cut: '2026-10-03', edge_processed: '2026-10-04T09:12:00.000Z' },
    })
    expect(p.lane).toBe('in_work')
    expect(p.progressPct).toBe(40)
    expect(p.stage).toBe('Сверление')
    expect(p.timeline.map(t => t.state)).toEqual(['done', 'done', 'now', 'wait', 'wait', 'wait'])
    expect(p.timeline[1].date).toBe('2026-10-04T09:12:00.000Z')
  })

  it('упакован, не отгружен — «Готов к выдаче», хотя сверление и закалку не отмечали', () => {
    const p = partnerProgress({ launched_at: '2026-10-01' }, {
      status: 'sent', stages: { cut: '2026-10-02', packaged: '2026-10-06T10:00:00.000Z' },
    })
    expect(p.ready).toBe(true)
    expect(p.stage).toBe('Готов к выдаче')
    expect(p.progressPct).toBe(100)
    expect(p.timeline.at(-1)).toEqual({ label: 'Отгрузка', state: 'now', date: null })
  })

  it('отгрузка ISO-временем — «Отгружен» с датой', () => {
    const p = partnerProgress({ launched_at: '2026-10-01' }, {
      status: 'sent', stages: { packaged: '2026-10-06', shipped: '2026-10-07T13:55:03.947Z' },
    })
    expect(p.lane).toBe('shipped')
    expect(p.ready).toBe(false)
    expect(p.timeline.at(-1)).toEqual({ label: 'Отгрузка', state: 'done', date: '2026-10-07T13:55:03.947Z' })
  })

  it('запущен, отметок нет — 0 %, ждём резку; «Чертёж» не показываем', () => {
    const p = partnerProgress({ launched_at: '2026-10-07' }, { status: 'sent', stages: {} })
    expect(p.progressPct).toBe(0)
    expect(p.stage).toBe('Резка')
    expect(p.timeline.map(t => t.label)).not.toContain('Чертёж подготовлен')
  })

  it('false/null у недоотмеченных старых заказов не считаются', () => {
    const p = partnerProgress({ launched_at: '2025-05-01' }, { status: 'confirmed', stages: { printed: true, cut: true, edge: false, packed: false, tempering: null } })
    expect(p.packed).toBe(false)
    expect(p.lane).toBe('in_work')
    expect(p.stage).toBe('Полировка')
  })

  it('просчёт и отправленный партнёром — вне производства', () => {
    expect(partnerProgress({ launched_at: null }, { status: 'quote' }).lane).toBe('quote')
    expect(partnerProgress({ launched_at: null }, { status: 'pending_approval' }).lane).toBe('submitted')
    expect(partnerProgress({ launched_at: null }, {}).progressPct).toBe(0)
  })

  it('запуск — колонка, notes.launched_at или статус «в работе»', () => {
    expect(isLaunched({ launched_at: '2026-10-01' }, {})).toBe(true)
    expect(isLaunched({ launched_at: null }, { launched_at: '2026-10-01' })).toBe(true)
    expect(isLaunched({ launched_at: null }, { status: 'sent' })).toBe(true)
    expect(isLaunched({ launched_at: null }, { status: 'agreed' })).toBe(false)
  })

  it('срок — от колонки запуска, когда в notes даты запуска нет', () => {
    const fromCol = partnerDeadline({ launched_at: '2026-10-01', created_at: '2026-09-01T10:00:00Z' }, { production_days: 10 })
    expect(fromCol.toISOString().slice(0, 10)).toBe('2026-10-11')
  })
})
