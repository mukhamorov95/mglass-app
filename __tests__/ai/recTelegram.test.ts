import { describe, expect, it } from 'vitest'
import { parseRecCallback, recKeyboard, recText } from '@/lib/ai/recTelegram'
import type { Recommendation } from '@/lib/ai/recommendationTypes'

const ID = 'f0ceee45-46cd-403a-8aac-153dad066f1b'

const rec = (over: Partial<Recommendation> = {}): Recommendation => ({
  id: ID, title: '119 квалифицированных → 5 замеров', priority: 'critical', category: 'Продажи',
  problem: 'Из 119 заявок <5% дошли до замера', impact: null, action: 'Разобрать 20 потерянных', metric: 'Доля замеров за 30 дней',
  perspective: 'sales', status: 'new', source: 'cron', created_at: '2026-09-17T06:00:00Z',
  decided_at: null, decided_by: null, result_note: null, done_at: null, ...over,
})

describe('parseRecCallback', () => {
  it('разбирает решение и id', () => {
    expect(parseRecCallback(`rec:archived:${ID}`)).toEqual({ status: 'archived', id: ID })
    expect(parseRecCallback(`rec:new:${ID}`)).toEqual({ status: 'new', id: ID })
  })
  it('«сделано» кнопкой не ставится, чужие и битые данные — мимо', () => {
    expect(parseRecCallback(`rec:done:${ID}`)).toBeNull()
    expect(parseRecCallback('rec:in_work:123')).toBeNull()
    expect(parseRecCallback(`agents:run:${ID}`)).toBeNull()
  })
  it('каждая кнопка укладывается в 64 байта callback_data', () => {
    for (const row of recKeyboard(rec())) for (const b of row) expect(Buffer.byteLength(b.callback_data ?? '')).toBeLessThanOrEqual(64)
  })
})

describe('recText', () => {
  it('экранирует HTML: «<5%» не ломает сообщение', () => {
    expect(recText(rec())).toContain('&lt;5%')
    expect(recText(rec())).not.toContain('<5%')
  })
  it('цифры с источником и пометка чисел не из данных', () => {
    const t = recText(rec({ evidence: {
      facts: [{ id: 'leads.measure.30d', label: 'Дошли до замера', value: 5, unit: 'count', period: 'последние 30 дней', source: 'заявки Авито-бота' }],
      check: 'leads.measure.30d', unverified: ['80'],
    } }))
    expect(t).toContain('• Дошли до замера: 5 (последние 30 дней) — заявки Авито-бота')
    expect(t).toContain('числа не из данных: 80')
  })
  it('после решения — статус и кто решил', () => {
    expect(recText(rec({ status: 'in_work', decided_by: 'admin@mglass.ru · Telegram' }))).toContain('В работе</b> · admin@mglass.ru · Telegram')
  })
})

describe('recKeyboard', () => {
  it('без решения — три кнопки', () => {
    expect(recKeyboard(rec())[0].map(b => b.callback_data)).toEqual([`rec:in_work:${ID}`, `rec:archived:${ID}`, `rec:removed:${ID}`])
  })
  it('после решения — «Вернуть» и страница; у сделанной — только страница', () => {
    const inWork = recKeyboard(rec({ status: 'in_work' }))[0]
    expect(inWork[0].callback_data).toBe(`rec:new:${ID}`)
    expect(inWork[1].url).toMatch(/\/admin\/ai-control-center$/)
    expect(recKeyboard(rec({ status: 'done' }))).toEqual([[expect.objectContaining({ text: 'Открыть' })]])
  })
})
