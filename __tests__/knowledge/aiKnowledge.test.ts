import { describe, it, expect } from 'vitest'
import { formatKnowledgeForBot, knowledgeAmounts, normalizeGapQuestion, isKnowledgeCategory } from '@/lib/knowledge/aiKnowledge'
import { guardPrices } from '@/lib/ai-tools/avitoGuards'

describe('база знаний → промпт бота', () => {
  it('группирует по разделам в порядке разделов, а не записей', () => {
    const text = formatKnowledgeForBot([
      { category: 'pricing', title: 'Скидки', content: 'Не даём.' },
      { category: 'company', title: 'Кто мы', content: 'M-Glass, Москва.' },
    ])
    expect(text.indexOf('## О компании')).toBeLessThan(text.indexOf('## Цены и условия'))
    expect(text).toContain('- Кто мы: M-Glass, Москва.')
  })
  it('пустая база — пустой блок', () => {
    expect(formatKnowledgeForBot([])).toBe('')
  })
  it('не раздувает промпт сверх потолка', () => {
    const big = Array.from({ length: 200 }, (_, i) => ({ category: 'products' as const, title: `Т${i}`, content: 'x'.repeat(200) }))
    expect(formatKnowledgeForBot([{ category: 'company', title: 'Кто мы', content: 'коротко' }, ...big]).length).toBeLessThan(13000)
  })
  it('разделы проверяются', () => {
    expect(isKnowledgeCategory('company')).toBe(true)
    expect(isKnowledgeCategory('hack')).toBe(false)
  })
})

describe('суммы из базы — утверждены, страж их не режет', () => {
  it('достаёт суммы с ₽ и «руб», с пробелами в разрядах', () => {
    expect(knowledgeAmounts('Замер 2500 ₽, доставка 5 000 руб., сроки 5–7 дней')).toEqual([2500, 5000])
  })
  it('сумма из базы проходит стража, выдуманная — нет', () => {
    const allowed = knowledgeAmounts('Доставка по МО — 5 000 ₽')
    expect(guardPrices('Доставка 5 000 ₽', allowed).replaced).toBe(0)
    expect(guardPrices('Душевая 48 000 ₽', allowed).replaced).toBe(1)
  })
})

describe('пробелы в знаниях', () => {
  it('нормализует вопрос', () => {
    expect(normalizeGapQuestion('  Какая   гарантия\n на душевую? ')).toBe('Какая гарантия на душевую?')
  })
})
