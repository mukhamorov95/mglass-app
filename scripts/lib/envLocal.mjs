// .env.local для скриптов — из этой копии репозитория, а если его там нет, из основной.
//
// Сессии работают в git worktree (.claude/worktrees/<имя>/), а .env.local не в git
// и лежит только в основной копии. Её корень — родитель общего .git
// (git rev-parse --git-common-dir). Файл не копируем: секреты живут в одном месте.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function loadEnvLocal() {
  const repo = fileURLToPath(new URL('../..', import.meta.url))
  const candidates = [join(repo, '.env.local')]
  try {
    const common = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    // в основной копии git отдаёт относительный «.git», в worktree — абсолютный путь
    const main = join(dirname(resolve(repo, common)), '.env.local')
    if (!candidates.includes(main)) candidates.push(main)
  } catch {}

  const file = candidates.find(p => existsSync(p))
  if (!file) {
    console.error(`ERROR: не найден .env.local — искал:\n  ${candidates.join('\n  ')}`)
    process.exit(1)
  }
  return Object.fromEntries(
    readFileSync(file, 'utf8')
      .split('\n').filter(l => l.includes('=') && !l.startsWith('#'))
      .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
  )
}
