import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// AmoCRM только на чтение. До 13.10.2026 три места писали туда заметки и задачи —
// правило жило в документах, а не в проверке. Этот тест — проверка.

const ROOTS = ['app', 'lib', 'scripts']
const SKIP_DIRS = new Set(['node_modules', '.next'])
const EXT = /\.(ts|tsx|js|mjs)$/

// Единственный законный не-GET запрос к amo: обновление OAuth-токена.
const ALLOWED_URL = /oauth2\/access_token/

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (EXT.test(name)) out.push(p)
  }
  return out
}

// Ищет fetch(...) с мутирующим методом, у которого адрес — amo: сам хост,
// переменная с базой amo (AMO_BASE и т. п.) или путь /api/v4/.
function amoWrites(src: string): string[] {
  const hits: string[] = []
  const METHOD = /method:\s*['"`](POST|PUT|PATCH|DELETE)['"`]/g
  let m: RegExpExecArray | null
  while ((m = METHOD.exec(src))) {
    const call = src.lastIndexOf('fetch(', m.index)
    if (call < 0 || m.index - call > 600) continue
    const head = src.slice(call, m.index)
    const isAmo = /amocrm\.ru|AMO_[A-Z_]*|amoBase|amoUrl|\/api\/v4\//.test(head)
    if (isAmo && !ALLOWED_URL.test(head)) hits.push(head.split('\n')[0].trim())
  }
  return hits
}

describe('AmoCRM только на чтение', () => {
  it('в коде нет POST/PUT/PATCH/DELETE к AmoCRM', () => {
    const offenders: { file: string; call: string }[] = []
    for (const root of ROOTS) {
      for (const file of walk(root)) {
        for (const call of amoWrites(readFileSync(file, 'utf8'))) offenders.push({ file, call })
      }
    }
    expect(offenders, 'запись в AmoCRM запрещена (docs/WORKING_RULES.md §1)').toEqual([])
  })

  it('страж ловит запись и пропускает чтение и токен', () => {
    expect(amoWrites("await fetch(`${AMO_BASE}/leads/1/notes`, {\n  method: 'POST',")).toHaveLength(1)
    expect(amoWrites("fetch(`https://${d}.amocrm.ru/api/v4/leads`, { method: 'PATCH' })")).toHaveLength(1)
    expect(amoWrites("fetch(`${AMO_BASE}/leads`, { headers })")).toHaveLength(0)
    expect(amoWrites("fetch(`https://${domain()}/oauth2/access_token`, {\n method: 'POST',")).toHaveLength(0)
    expect(amoWrites("fetch('/api/amo/calls/analyze', { method: 'POST' })")).toHaveLength(0)
  })
})
