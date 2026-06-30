// One-shot read-only dump of b2b_orders (orders + quotes) for May/June 2026 reconciliation
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8')
    .split('\n').filter(l => l && !l.startsWith('#'))
    .map(l => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    })
)

const url = env.NEXT_PUBLIC_SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing SUPABASE env vars')
  process.exit(1)
}

const sb = createClient(url, key, { auth: { persistSession: false } })

async function fetchRange(fromIso, toIso) {
  const { data, error } = await sb
    .from('b2b_orders')
    .select('id, custom_number, client_order_number, client_id, client_name, total_after_discount, total_sale_inc_vat, notes, created_at, archived_at, created_by, organization_id')
    .gte('created_at', fromIso)
    .lt('created_at', toIso)
    .order('created_at', { ascending: true })
    .limit(5000)
  if (error) throw error
  return data
}

function parseNotes(n) {
  if (!n) return {}
  if (typeof n === 'object') return n
  try { return JSON.parse(n) } catch { return { _raw: n } }
}

function classify(r) {
  const meta = parseNotes(r.notes)
  const status = meta.status || null
  const launchedAt = meta.launched_at || null
  return { status, launchedAt, isQuote: status === 'quote' }
}

const may = await fetchRange('2026-05-01T00:00:00Z', '2026-06-01T00:00:00Z')
const june = await fetchRange('2026-06-01T00:00:00Z', '2026-07-01T00:00:00Z')

// Also fetch by launched_at — try filter on notes ilike
async function fetchByLaunchMonth(mm) {
  const { data, error } = await sb
    .from('b2b_orders')
    .select('id, custom_number, client_order_number, client_name, total_after_discount, total_sale_inc_vat, notes, created_at, archived_at')
    .ilike('notes', `%"launched_at":"2026-${mm}-%`)
    .order('id', { ascending: true })
    .limit(5000)
  if (error) throw error
  return data
}

const mayLaunched = await fetchByLaunchMonth('05')
const juneLaunched = await fetchByLaunchMonth('06')

const summary = {
  may_created: may.length,
  june_created: june.length,
  may_launched: mayLaunched.length,
  june_launched: juneLaunched.length,
}

function dump(label, rows) {
  console.log(`\n=== ${label} (${rows.length} rows) ===`)
  for (const r of rows) {
    const meta = parseNotes(r.notes)
    console.log([
      r.id,
      r.custom_number ?? '',
      r.client_order_number ?? '',
      r.client_name ?? '',
      r.total_after_discount ?? r.total_sale_inc_vat ?? '',
      r.created_at?.slice(0, 10) ?? '',
      meta.status ?? '',
      meta.launched_at?.slice(0, 10) ?? '',
      r.archived_at ? 'ARCH' : '',
    ].join(' | '))
  }
}

console.log('Summary:', summary)
dump('CREATED in MAY 2026', may)
dump('CREATED in JUNE 2026', june)
dump('LAUNCHED in MAY 2026 (any created_at)', mayLaunched)
dump('LAUNCHED in JUNE 2026 (any created_at)', juneLaunched)

// Also persist as JSON for downstream comparison
fs.mkdirSync('/tmp/reco', { recursive: true })
fs.writeFileSync('/tmp/reco/app_may_created.json', JSON.stringify(may, null, 2))
fs.writeFileSync('/tmp/reco/app_june_created.json', JSON.stringify(june, null, 2))
fs.writeFileSync('/tmp/reco/app_may_launched.json', JSON.stringify(mayLaunched, null, 2))
fs.writeFileSync('/tmp/reco/app_june_launched.json', JSON.stringify(juneLaunched, null, 2))
