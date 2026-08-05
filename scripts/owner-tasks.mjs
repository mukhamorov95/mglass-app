// Очередь задач владельца из Telegram-бота + воркер-захват («клад»).
// Запуск из mglass-app:
//   node scripts/owner-tasks.mjs                — показать очередь + статус воркеров
//   node scripts/owner-tasks.mjs heartbeat      — отметить воркер живым на этой машине
//   node scripts/owner-tasks.mjs claim          — атомарно забрать следующую задачу (+heartbeat)
//   node scripts/owner-tasks.mjs take 5         — взять #5 (только если ещё в очереди)
//   node scripts/owner-tasks.mjs done 5 "что"   — закрыть
//   node scripts/owner-tasks.mjs cancel 5       — отменить
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { hostname } from 'node:os'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const WORKER = hostname()

const [cmd, idArg, ...noteParts] = process.argv.slice(2)

async function heartbeat() {
  await sb.from('owner_task_workers')
    .upsert({ worker_id: WORKER, machine: WORKER, last_seen: new Date().toISOString() })
}

if (cmd === 'heartbeat') {
  await heartbeat()
  console.log(`♥ воркер активен: ${WORKER}`)
  process.exit(0)
}

if (cmd === 'claim') {
  await heartbeat()
  const { data, error } = await sb.rpc('claim_next_owner_task', { p_worker: WORKER })
  if (error) { console.log('ERROR:', error.message); process.exit(1) }
  const t = Array.isArray(data) ? data[0] : data
  if (!t || !t.id) { console.log('Очередь пуста — нечего брать.'); process.exit(0) }
  console.log(`Взято #${t.id} [${t.priority}/${t.category}] ${t.title}`)
  if (t.details && t.details !== t.title) console.log(`    ${t.details}`)
  process.exit(0)
}

if (cmd === 'take' || cmd === 'done' || cmd === 'cancel') {
  const status = cmd === 'take' ? 'in_progress' : cmd === 'done' ? 'done' : 'cancelled'
  const patch = { status, updated_at: new Date().toISOString() }
  if (cmd === 'take') { patch.claimed_by = WORKER; patch.claimed_at = new Date().toISOString() }
  if (noteParts.length) patch.result_note = noteParts.join(' ')
  let q = sb.from('owner_tasks').update(patch).eq('id', Number(idArg))
  if (cmd === 'take') q = q.eq('status', 'queued')  // атомарно: не перехватить чужую взятую
  const { data, error } = await q.select('id')
  if (error) { console.log('ERROR:', error.message); process.exit(1) }
  if (cmd === 'take' && !data?.length) { console.log(`#${idArg} уже взята или не в очереди`); process.exit(0) }
  console.log(`#${idArg} → ${status}`)
  process.exit(0)
}

// ── листинг очереди + статус воркеров ──
const { data: workers } = await sb.from('owner_task_workers')
  .select('worker_id, last_seen').order('last_seen', { ascending: false }).limit(5)
const alive = (workers ?? []).filter(w => Date.now() - new Date(w.last_seen).getTime() < 5 * 60_000)
if (alive.length) console.log(`🟢 Воркер активен: ${alive.map(w => w.worker_id).join(', ')}\n`)
else console.log('⚪️ Воркер не запущен — новые задачи ждут следующего старта\n')

const { data, error } = await sb.from('owner_tasks')
  .select('id, title, details, category, priority, source, status, created_at')
  .in('status', ['queued', 'in_progress'])
  .order('priority', { ascending: false }).order('created_at')
if (error) { console.log('ERROR:', error.message); process.exit(1) }
if (!data?.length) { console.log('Очередь владельца пуста.'); process.exit(0) }
console.log(`ОЧЕРЕДЬ ВЛАДЕЛЬЦА: ${data.length} задач(и)\n`)
for (const t of data) {
  console.log(`#${t.id} [${t.priority}/${t.category}/${t.status}] ${t.title}`)
  if (t.details && t.details !== t.title) console.log(`    ${t.details}`)
  console.log(`    (${t.source}, ${new Date(t.created_at).toLocaleString('ru-RU')})`)
}
