import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// notes заказа пишут и браузер (JSON.stringify — `"status":"quote"`), и функции базы
// (jsonb::text — `"status": "quote"`). 21.10 в «Заказах» висели 12 просчётов второго вида:
// фильтр знал только первый. Каждый фильтр по подстроке notes обязан знать оба.
const root = join(__dirname, '..', '..')
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}
const files = ['app', 'lib', 'components'].flatMap(d => walk(join(root, d)))

describe('фильтры по notes знают обе записи JSON', () => {
  const pairs = [
    [`'%"status":"quote"%'`, `'%"status": "quote"%'`],
    [`'%"historical":true%'`, `'%"historical": true%'`],
  ] as const
  it.each(pairs)('%s ходит в паре с записью с пробелом', (compact, spaced) => {
    const bad: string[] = []
    let seen = 0
    for (const f of files) {
      const lines = readFileSync(f, 'utf8').split('\n')
      lines.forEach((l, i) => {
        if (!l.includes(`.not('notes', 'ilike', ${compact})`)) return
        seen++
        if (!lines.slice(Math.max(0, i - 2), i + 3).some(x => x.includes(spaced))) bad.push(`${f.slice(root.length + 1)}:${i + 1}`)
      })
    }
    expect(seen).toBeGreaterThan(0)
    expect(bad).toEqual([])
  })
})
