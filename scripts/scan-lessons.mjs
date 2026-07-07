// Уроки скана дизайн-проектов (замечания менеджеров) — разбор при старте сессии.
// Запуск из mglass-app:  node scripts/scan-lessons.mjs        — показать непереваренные
//                        node scripts/scan-lessons.mjs done   — пометить все переваренными
//                        node scripts/scan-lessons.mjs done 5 — пометить урок #5
// «Переварить» = обобщить уроки и вшить постоянные правила в SYSTEM промпт
// app/api/ai/scan-design/route.ts (секция ЧАСТЫЕ ЛОВУШКИ), после чего пометить done.
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const [cmd, idArg] = process.argv.slice(2)

if (cmd === 'done') {
  const q = sb.from('design_scan_lessons').update({ digested: true })
  const { error } = idArg ? await q.eq('id', Number(idArg)) : await q.eq('digested', false)
  console.log(error ? `ERROR: ${error.message}` : (idArg ? `#${idArg} переварен` : 'Все уроки помечены переваренными'))
  process.exit(0)
}

const { data, error } = await sb.from('design_scan_lessons')
  .select('id, lesson, created_at')
  .eq('digested', false)
  .order('created_at')
if (error) { console.log('ERROR:', error.message); process.exit(1) }
if (!data?.length) { console.log('Непереваренных уроков скана нет.'); process.exit(0) }
console.log(`УРОКИ СКАНА (непереваренные): ${data.length}\n`)
for (const l of data) {
  console.log(`#${l.id} (${new Date(l.created_at).toLocaleString('ru-RU')})`)
  console.log(`    ${l.lesson}\n`)
}
console.log('→ Обобщи повторяющиеся уроки в постоянные правила SYSTEM промпта app/api/ai/scan-design/route.ts,')
console.log('  затем: node scripts/scan-lessons.mjs done')
