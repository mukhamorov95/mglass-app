// Очередь задач владельца из Telegram-бота.
// Запуск из mglass-app:  node scripts/owner-tasks.mjs           — показать очередь
//                        node scripts/owner-tasks.mjs take 5    — взять задачу #5 в работу
//                        node scripts/owner-tasks.mjs done 5 "что сделано" — закрыть
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const [cmd, idArg, ...noteParts] = process.argv.slice(2)

if (cmd === 'take' || cmd === 'done' || cmd === 'cancel') {
  const status = cmd === 'take' ? 'in_progress' : cmd === 'done' ? 'done' : 'cancelled'
  const patch = { status, updated_at: new Date().toISOString() }
  if (noteParts.length) patch.result_note = noteParts.join(' ')
  const { error } = await sb.from('owner_tasks').update(patch).eq('id', Number(idArg))
  console.log(error ? `ERROR: ${error.message}` : `#${idArg} → ${status}`)
  process.exit(0)
}

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
