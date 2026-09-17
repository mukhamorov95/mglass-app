import { describe, it, expect } from 'vitest'
import { handoffReply } from '@/lib/ai-tools/avitoManagerRuntime'
import { replyBudget, fitsReply, trimReply, countQuestions, REPLY_MIN, REPLY_MAX } from '@/lib/ai-tools/avitoGuards'

describe('длина ответа — в длину клиента', () => {
  it('короткое «Да» — минимум, чтобы уместить ответ и вопрос', () => {
    expect(replyBudget('Да')).toBe(REPLY_MIN)
  })
  it('обычное сообщение клиента (43 символа) — около 100', () => {
    expect(replyBudget('Здравствуйте, нужна перегородка на поддон')).toBe(101)
  })
  it('длинное сообщение — не больше потолка', () => {
    expect(replyBudget('а'.repeat(1000))).toBe(REPLY_MAX)
  })
  it('два вопроса не проходят, даже если коротко', () => {
    expect(fitsReply('Какой размер? Какой город?', 200)).toBe(false)
    expect(countQuestions('Какой размер?')).toBe(1)
  })
})

describe('обрезка, если модель не уложилась', () => {
  const long = 'Здравствуйте! Душевые — наш профиль, делаем под размер на своём производстве. Замер по Москве идёт в зачёт заказа. Подскажите размеры проёма? И готова ли плитка?'
  it('укладывается в лимит и оставляет ровно один вопрос', () => {
    const out = trimReply(long, 100)
    expect(out.length).toBeLessThanOrEqual(100)
    expect(countQuestions(out)).toBe(1)
    expect(out).toContain('размеры')
  })
  it('короткий ответ не трогает содержание', () => {
    expect(trimReply('Здравствуйте! Какие размеры?', 100)).toBe('Здравствуйте! Какие размеры?')
  })
})

describe('ответ при передаче менеджеру', () => {
  it('сохраняет ответ на вопрос клиента, убирает вопросы, добавляет передачу', () => {
    const out = handoffReply('Да, делаем такие перегородки. Какие размеры проёма?', false)
    expect(out).toContain('делаем')
    expect(out).not.toContain('?')
    expect(out).toContain('Оставьте телефон')
  })
  it('телефон уже есть — не просит его снова', () => {
    const out = handoffReply('Какие размеры?', true)
    expect(out).toBe('Спасибо! Передаю менеджеру — он посчитает и свяжется с вами.')
  })
  it('модель сама сказала о передаче — фразу не дублирует', () => {
    expect(handoffReply('Понял. Передаю менеджеру, он свяжется.', true)).toBe('Понял. Передаю менеджеру, он свяжется.')
  })
  it('«менеджер посчитает» без телефона — добавляет передачу и просьбу о телефоне', () => {
    const out = handoffReply('Точную цену менеджер посчитает под ваши размеры.', false)
    expect(out).toContain('Передаю менеджеру')
    expect(out).toContain('телефон')
  })
})
