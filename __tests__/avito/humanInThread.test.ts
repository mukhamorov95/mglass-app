import { describe, it, expect } from 'vitest'
import { findHumanOutgoing } from '@/lib/avito/humanInThread'
import type { AvitoMsg } from '@/lib/avito'

const SELF = 100
const msg = (text: string, out: boolean): AvitoMsg => ({ id: text, author_id: out ? SELF : 7, direction: out ? 'out' : 'in', content: { text } })

describe('был ли в чате Авито живой менеджер', () => {
  it('только бот и клиент — людей нет', () => {
    const msgs = [msg('Здравствуйте', false), msg('Добрый день! Что за изделие?', true)]
    expect(findHumanOutgoing(msgs, SELF, ['Добрый день!  Что за изделие?'])).toBeNull()
  })
  it('лид 405: менеджер написал из Авито, в ленте его нет — найден', () => {
    const msgs = [msg('Ок', false), msg('Не обращайте внимание на бота\nМы не беремся только за монтаж изделия', true)]
    expect(findHumanOutgoing(msgs, SELF, ['Принято! Менеджер свяжется'])).toContain('Не обращайте')
  })
  it('длинный ответ бота, обрезанный в ленте, остаётся ботом', () => {
    const long = 'а'.repeat(5000)
    expect(findHumanOutgoing([msg(long, true)], SELF, [long.slice(0, 4000)])).toBeNull()
  })
  it('входящие и пустые не считаются', () => {
    expect(findHumanOutgoing([msg('Цена?', false), msg('   ', true)], SELF, [])).toBeNull()
  })
})
