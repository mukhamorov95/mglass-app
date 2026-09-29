import { describe, it, expect } from 'vitest'
import { dayNote, fmtDur, teamSummary, type LeadDayFacts } from '@/lib/dayNotes/rules'

const msk = (s: string) => Date.parse(`${s}:00+03:00`) / 1000
const NOW = msk('2026-09-29T19:00')

const lead = (over: Partial<LeadDayFacts> = {}): LeadDayFacts => ({
  leadId: 1, name: 'Душевая 1200', url: 'https://x.amocrm.ru/leads/detail/1',
  responsibleId: 10, responsible: 'Яна', createdAt: msk('2026-09-29T14:53'), daytime: true,
  stageAtStart: null, stageNow: 'Получена новая заявка', closed: null,
  firstTouchAt: null, waitingSince: null, missed: [], task: null,
  ...over,
})

describe('примечание «Итог дня»', () => {
  it('нет касания и задачи — плохо и внимание, на завтра два шага', () => {
    const n = dayNote(lead(), NOW)
    expect(n.bad).toEqual(['В amo нет ни сообщения, ни звонка клиенту'])
    expect(n.attention).toEqual(['Нет задачи со следующим шагом'])
    expect(n.tomorrow).toEqual(['связаться с клиентом с утра', 'поставить задачу со следующим шагом'])
    expect(n.text.split('\n')[1]).toBe('Пришла 14:53 · сейчас: Получена новая заявка')
  })

  it('быстрое касание днём — хорошо, медленное — плохо, среднее — просто факт', () => {
    expect(dayNote(lead({ firstTouchAt: msk('2026-09-29T15:03') }), NOW).good[0]).toBe('Первое сообщение или звонок — 15:03, через 10 мин')
    expect(dayNote(lead({ firstTouchAt: msk('2026-09-29T17:05') }), NOW).bad[0]).toBe('Первое сообщение или звонок — 17:05, через 2 ч 12 мин')
    const mid = dayNote(lead({ firstTouchAt: msk('2026-09-29T15:23') }), NOW)
    expect(mid.good.concat(mid.bad)).not.toContain(expect.stringContaining('Первое'))
    expect(mid.text).toContain('первое сообщение или звонок — 15:23, через 30 мин')
  })

  it('заявку вне рабочего времени по скорости не судим', () => {
    const n = dayNote(lead({ createdAt: msk('2026-09-28T21:04'), daytime: false, firstTouchAt: msk('2026-09-29T09:40') }), NOW)
    expect(n.bad).toEqual([])
    expect(n.good[0]).toBe('Первое сообщение или звонок — 09:40, через 12 ч 36 мин')
    expect(n.text).toContain('Пришла 28.09 21:04 — вне рабочего времени')
  })

  it('клиент ждёт ответа и пропущенный без перезвона — плохо; с касанием после — внимание', () => {
    const n = dayNote(lead({
      firstTouchAt: msk('2026-09-29T14:58'),
      waitingSince: msk('2026-09-29T17:42'),
      missed: [
        { at: msk('2026-09-29T16:10'), attempts: 2, after: null },
        { at: msk('2026-09-29T11:00'), attempts: 1, after: { at: msk('2026-09-29T11:20'), what: 'сообщение' } },
      ],
      task: { text: 'Отправить КП', dueAt: msk('2026-09-30T10:00') },
    }), NOW)
    expect(n.bad).toEqual(['Клиент написал в 17:42 и ждёт ответа', 'Пропущенный звонок в 16:10 (2 раза) — не перезвонили'])
    expect(n.attention).toEqual(['Пропущенный звонок в 11:00 — не перезвонили, после него было сообщение в 11:20'])
    expect(n.good).toContain('Следующий шаг: «Отправить КП» — 30.09 10:00')
    expect(n.tomorrow).toEqual(['первым делом ответить в чате', 'перезвонить'])
  })

  it('закрытую заявку не упрекаем касанием и задачей', () => {
    const n = dayNote(lead({ closed: 'lost', stageNow: 'Закрыто и не реализовано' }), NOW)
    expect(n.bad).toEqual([])
    expect(n.attention).toEqual([])
    expect(n.text).toContain('сейчас: Закрыто и не реализовано')
    expect(n.text).toContain('➡️ Завтра: по плану, замечаний нет')
  })

  it('задача без текста — по сроку', () => {
    expect(dayNote(lead({ firstTouchAt: msk('2026-09-29T14:55'), task: { text: ' ', dueAt: msk('2026-09-30T16:44') } }), NOW).good)
      .toContain('Следующий шаг: задача на 30.09 16:44')
  })

  it('просроченная задача — плохо; перевод по этапу — хорошо', () => {
    const n = dayNote(lead({
      firstTouchAt: msk('2026-09-29T14:55'), stageAtStart: 'Получена новая заявка', stageNow: 'Замер назначен',
      task: { text: 'Перезвонить', dueAt: msk('2026-09-29T16:00') },
    }), NOW)
    expect(n.good).toContain('Этап: Получена новая заявка → Замер назначен')
    expect(n.bad).toEqual(['Задача «Перезвонить» просрочена, срок 16:00'])
  })
})

describe('итог по команде', () => {
  it('знаменатели, экранирование и пробный режим', () => {
    const facts = [
      lead({ leadId: 1, name: 'A <b>', firstTouchAt: msk('2026-09-29T14:58') }),
      lead({ leadId: 2, responsible: 'Семён', firstTouchAt: null }),
      lead({ leadId: 3, daytime: false, createdAt: msk('2026-09-28T22:00'), firstTouchAt: msk('2026-09-29T09:30'), task: { text: 'x', dueAt: NOW + 3600 } }),
    ]
    const s = teamSummary({ from: NOW - 86400, now: NOW, mode: 'dry', facts, notes: facts.map(f => dayNote(f, NOW)), noDealMissed: 2, written: 0 })
    expect(s).toContain('Заявок: <b>3</b> (Яна 2 · Семён 1)')
    expect(s).toContain('до 15 мин: 1 из 2 открытых, пришедших в рабочее время')
    expect(s).toContain('Нет задачи со следующим шагом: 2 из 3 открытых')
    expect(s).toContain('Семён: В amo нет ни сообщения, ни звонка клиенту')
    expect(s).not.toContain('A <b>')
    expect(s).toContain('номеров без сделки: 2')
    expect(s).toContain('Режим пробный: в amo ничего не записано')
  })

  it('длительности', () => {
    expect(fmtDur(5)).toBe('5 мин')
    expect(fmtDur(60)).toBe('1 ч')
    expect(fmtDur(1500)).toBe('1 дн 1 ч')
  })
})
