import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CONTOURS, RARE, itemsOf, contourFor, matchLength } from '@/lib/nav/contours'

const root = join(__dirname, '..', '..')
const src = (p: string) => readFileSync(join(root, p), 'utf8')

// Пункты, которых у владельца в старом меню не было: меню других ролей и личная вкладка.
const NOT_OWNER_MENU = new Set([
  '/vlad',                 // личная вкладка — рисуется над меню отдельно
  '/admin/guide',          // закупщик
  '/b2b-analytics', '/ai-sales', '/ai-assistant', '/kp-generator',  // роли seo / ceo
])

const hrefsIn = (text: string) => [...text.matchAll(/href: '([^']+)'/g)].map(m => m[1].split('?')[0])

describe('меню по контурам', () => {
  const all = new Set([...Object.values(CONTOURS).flatMap(itemsOf), ...RARE].map(i => i.href.split('?')[0]))

  it('ни один пункт старого меню не потерялся', () => {
    const old = new Set([...hrefsIn(src('components/Sidebar.tsx')), ...hrefsIn(src('lib/nav/managerMenu.ts'))])
    expect(old.size).toBeGreaterThan(100)   // разбор исходника жив: пустой список «потерь» иначе ничего не доказывает
    const lost = [...old].filter(h => !all.has(h) && !NOT_OWNER_MENU.has(h))
    expect(lost).toEqual([])
  })

  it('плитки Owner Center достижимы: хаб в меню', () => {
    expect(all.has('/admin/owner')).toBe(true)
  })

  it('внутри контура адрес не повторяется', () => {
    for (const [c, entries] of Object.entries(CONTOURS)) {
      const hrefs = itemsOf(entries).map(i => i.href)
      expect(hrefs.length, c).toBe(new Set(hrefs).size)
    }
  })

  it('«Редкое» не дублирует пункты контуров', () => {
    const inContours = new Set(Object.values(CONTOURS).flatMap(itemsOf).map(i => i.href))
    expect(RARE.filter(i => inContours.has(i.href)).map(i => i.href)).toEqual([])
  })

  it('открытый адрес выбирает свой контур, общий — не перебрасывает', () => {
    expect(contourFor('/b2b-quotes/15/kp', 'mglass')).toBe('b2b')
    expect(contourFor('/cfo/cashflow', 'b2b')).toBe('ceo')
    expect(contourFor('/deal/77', 'b2b')).toBe('b2b')            // нет ни в одном — остаёмся
    expect(contourFor('/inventory', 'b2b')).toBe('b2b')          // есть в обоих — остаёмся
    expect(contourFor('/inventory', 'mglass')).toBe('mglass')
    expect(contourFor('/admin/glass-prices', 'mglass')).toBe('b2b')
  })

  it('корень совпадает только сам с собой', () => {
    expect(matchLength('/', '/')).toBeGreaterThan(0)
    expect(matchLength('/deals', '/')).toBe(0)
    expect(matchLength('/cfo/products', '/cfo')).toBe(4)
  })
})
