// Read-only check: which new authorship columns exist on b2b_orders in prod.
// PostgREST returns 400 with a "column X does not exist" message when a SELECT
// names a missing column. We probe each column individually so partial states
// are visible.
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8')
    .split('\n').filter(l => l && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i+1).trim()] })
)
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

const COLUMNS = [
  'created_by_name',
  'updated_by_user_id',
  'updated_by_name',
  'updated_at',
  'converted_by_user_id',
  'converted_by_name',
  'launched_by_user_id',
  'launched_by_name',
  'launched_at',
]

const results = {}
for (const col of COLUMNS) {
  const { error } = await sb.from('b2b_orders').select(col).limit(1)
  if (error) {
    results[col] = { exists: false, error: error.message }
  } else {
    results[col] = { exists: true }
  }
}

const have = COLUMNS.filter(c => results[c].exists)
const miss = COLUMNS.filter(c => !results[c].exists)

console.log('=== b2b_orders authorship columns ===')
for (const c of COLUMNS) {
  console.log(`  ${results[c].exists ? '✓' : '✗'}  ${c}${results[c].error ? '  ('+results[c].error.split('\n')[0]+')' : ''}`)
}
console.log()
console.log(`Present: ${have.length}/9`)
console.log(`Missing: ${miss.length}/9${miss.length ? '  → '+miss.join(', ') : ''}`)
console.log()
console.log(have.length === 9
  ? 'Migration 20260630_b2b_orders_authorship.sql IS APPLIED.'
  : 'Migration 20260630_b2b_orders_authorship.sql is NOT (fully) applied.')
