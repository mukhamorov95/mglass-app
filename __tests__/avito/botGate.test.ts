import { describe, it, expect } from 'vitest'
import { botGate, isAiManager, isOwnBotEcho, AI_MANAGERS } from '@/lib/avito/botGate'

const QUAL = new Set(['Получена новая заявка', 'Назначен ответственный', 'Проработка'])

describe('замок Ивана — когда бот молчит', () => {
  it('лид за ботом в квалификации — отвечает', () => {
    expect(botGate({ manager: 'Иван (AI)', stage: 'Проработка' }, QUAL)).toEqual({ allowed: true })
    expect(botGate({ manager: null, stage: 'Проработка' }, QUAL)).toEqual({ allowed: true })
  })

  it('bot_muted — молчит, даже если ответственный ещё «Иван (AI)»', () => {
    const v = botGate({ manager: 'Иван (AI)', bot_muted: true, bot_muted_by: 'Александра', stage: 'Проработка' }, QUAL)
    expect(v).toEqual({ allowed: false, reason: 'muted', who: 'Александра' })
  })

  it('ответственный — человек', () => {
    expect(botGate({ manager: 'Александра' }, QUAL)).toEqual({ allowed: false, reason: 'human', who: 'Александра' })
    expect(botGate({ manager: 'Импорт с Авито' }, QUAL).allowed).toBe(false)
  })

  it('вышли из квалификации или сделка закрыта', () => {
    expect(botGate({ manager: 'Иван (AI)', stage: 'Замер назначен' }, QUAL).allowed).toBe(false)
    expect(botGate({ manager: 'Иван (AI)', stage: 'Проработка', status: 'won' }, QUAL).allowed).toBe(false)
  })

  it('имена AI-менеджеров — один список на систему', () => {
    expect(AI_MANAGERS).toEqual(['Иван (AI)', 'AI-менеджер'])
    expect(isAiManager('Иван (AI)')).toBe(true)
    expect(isAiManager('Максим')).toBe(false)   // легаси-имя живого человека
    expect(isAiManager(null)).toBe(false)
  })
})

describe('эхо Авито — бот или менеджер написал', () => {
  const botTexts = ['Здравствуйте! Подскажите размеры проёма.', 'Принято! Фиксирую заявку: душевая перегородка.']

  it('дословное совпадение — это наше эхо', () => {
    expect(isOwnBotEcho('Здравствуйте! Подскажите размеры проёма.', botTexts)).toBe(true)
    expect(isOwnBotEcho('  здравствуйте!   подскажите размеры проёма. ', botTexts)).toBe(true)
  })

  it('другой текст в исходящих — писал человек', () => {
    expect(isOwnBotEcho('Сергей, добрый день! Готов подъехать на замер в четверг.', botTexts)).toBe(false)
  })

  it('пустое эхо работой менеджера не считаем', () => {
    expect(isOwnBotEcho('   ', botTexts)).toBe(true)
  })
})
