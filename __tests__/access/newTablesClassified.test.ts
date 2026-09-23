import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isClassifiedTable } from '@/lib/security/accessAudit'

// Ежемесячный прогон доступов знает только те таблицы, о которых ему сказали.
// Правило «новая таблица с деньгами или людьми — в SENSITIVE_TABLES в том же PR»
// 23.09 не сработало на первой же новой таблице (b2b_rates): его держала память.
// Теперь его держит этот тест. Проверяются миграции с 23.09 — старые разобраны вручную.
const SINCE = '20260923'
const DIR = join(process.cwd(), 'supabase/migrations')

function createdTables(): { file: string; table: string }[] {
  const out: { file: string; table: string }[] = []
  for (const file of readdirSync(DIR).filter(f => f.endsWith('.sql') && f >= SINCE).sort()) {
    const sql = readFileSync(join(DIR, file), 'utf8').replace(/--.*$/gm, '')
    for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z0-9_]+)"?/gi)) {
      out.push({ file, table: m[1].toLowerCase() })
    }
  }
  return out
}

describe('новые таблицы классифицированы для прогона доступов', () => {
  it('разбор миграций находит таблицы (иначе тест проверяет пустоту)', () => {
    expect(createdTables().map(t => t.table)).toContain('b2b_rates')
  })

  it('каждая таблица из новых миграций — в SENSITIVE_TABLES, NOT_SENSITIVE_TABLES или публичных списках', () => {
    const unclassified = createdTables().filter(t => !isClassifiedTable(t.table))
    expect(unclassified, 'добавьте таблицу в один из списков lib/security/accessAudit.ts').toEqual([])
  })
})
