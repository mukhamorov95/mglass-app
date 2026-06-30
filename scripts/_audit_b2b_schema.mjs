// Read-only schema audit for b2b_orders
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8')
    .split('\n').filter(l => l && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i+1).trim()] })
)
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

// Pull one recent row to see all columns
const { data: sample } = await sb.from('b2b_orders').select('*').order('id', { ascending: false }).limit(1)
console.log('=== b2b_orders columns (from sample row) ===')
console.log(Object.keys(sample[0] || {}).sort())

// Count by notes.status (approx — extract via raw)
const { data, error } = await sb.from('b2b_orders').select('id, notes, archived_at').limit(5000)
if (error) { console.error(error); process.exit(1) }
const c = { quote: 0, sent: 0, agreed: 0, confirmed: 0, pending_approval: 0, rejected: 0, other: 0, no_status: 0, archived: 0 }
for (const r of data) {
  if (r.archived_at) c.archived++
  try {
    const s = JSON.parse(r.notes || '{}').status
    if (!s) c.no_status++
    else if (s in c) c[s]++
    else c.other++
  } catch { c.no_status++ }
}
console.log('\n=== b2b_orders status distribution (incl archived) ===')
console.log(c)
console.log(`Total: ${data.length}`)
