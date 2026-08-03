// Майнинг «золотых» ответов менеджеров из истории CRM для обучения бота «Иван».
// Идёт по crm_lead_events, находит пары «сообщение(я) клиента → ответ живого
// менеджера» (не бота) и складывает в ai_manager_examples (Фаза 3).
// Идемпотентно: дубли отсекаются по hash. Наполнение читает lib/avito/managerExamples.ts.
//
// Запуск из mglass-app:  node scripts/mine-manager-replies.mjs
//                        node scripts/mine-manager-replies.mjs --dry   (только показать статистику)

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const DRY = process.argv.includes('--dry')

// Слишком короткие/дежурные ответы не учат стилю — пропускаем.
const GENERIC = new Set(['ок', 'окей', 'да', 'нет', 'хорошо', 'спасибо', 'принял', 'принято', '+', 'ага', 'угу', 'здравствуйте', 'добрый день'])
const isGeneric = (s) => GENERIC.has(s.trim().toLowerCase().replace(/[.!,)]+$/, ''))

const hashOf = (a, b) => createHash('sha1').update(a + '' + b).digest('hex').slice(0, 24)

async function fetchAll(table, cols, extra = q => q) {
  const page = 1000
  let from = 0, out = []
  for (;;) {
    const { data, error } = await extra(sb.from(table).select(cols)).range(from, from + page - 1)
    if (error) { console.error(`ERROR ${table}:`, error.message); process.exit(1) }
    out = out.concat(data ?? [])
    if (!data || data.length < page) break
    from += page
  }
  return out
}

// Лиды: продукт + флаг «продано» (сигнал качества примера).
const leads = await fetchAll('crm_leads', 'id,product,status')
const leadMeta = new Map(leads.map(l => [l.id, { product: l.product ?? null, won: l.status === 'won' }]))

// Сообщения в хронологии по каждому лиду.
const events = await fetchAll('crm_lead_events', 'lead_id,text,id', q => q.eq('kind', 'message').order('lead_id').order('id'))

const byLead = new Map()
for (const e of events) {
  if (!byLead.has(e.lead_id)) byLead.set(e.lead_id, [])
  byLead.get(e.lead_id).push(e.text ?? '')
}

const rows = []
for (const [leadId, msgs] of byLead) {
  const meta = leadMeta.get(leadId) ?? { product: null, won: false }
  let clientBuf = []
  for (const t of msgs) {
    if (t.startsWith('КЛИЕНТ: ')) {
      clientBuf.push(t.slice(8).trim())
      if (clientBuf.length > 2) clientBuf = clientBuf.slice(-2)   // держим последние 2 реплики
    } else if (t.startsWith('МЕНЕДЖЕР: ')) {
      const reply = t.slice(10).trim()
      const context = clientBuf.join(' ').trim()
      if (context.length >= 3 && reply.length >= 15 && !isGeneric(reply)) {
        rows.push({
          lead_id: leadId, product: meta.product, won: meta.won,
          client_context: context.slice(0, 1000), manager_reply: reply.slice(0, 1500),
          source: 'mined', hash: hashOf(context, reply),
        })
      }
      clientBuf = []
    } else {
      // БОТ: … или системное — сбрасываем буфер (человек отвечает на новую реплику).
      clientBuf = []
    }
  }
}

// Дедуп внутри батча по hash.
const uniq = new Map(rows.map(r => [r.hash, r]))
const batch = [...uniq.values()]

console.log(`Лидов с перепиской: ${byLead.size} · сообщений: ${events.length}`)
console.log(`Найдено пар «клиент → менеджер»: ${rows.length} (уникальных: ${batch.length}, из них won: ${batch.filter(r => r.won).length})`)

if (DRY) {
  console.log('\n— примеры (первые 3) —')
  for (const r of batch.slice(0, 3)) console.log(`\nКЛИЕНТ: ${r.client_context}\nМЕНЕДЖЕР: ${r.manager_reply}`)
  console.log('\n[--dry] запись отключена')
  process.exit(0)
}

let inserted = 0
for (let i = 0; i < batch.length; i += 500) {
  const chunk = batch.slice(i, i + 500)
  const { data, error } = await sb.from('ai_manager_examples')
    .upsert(chunk, { onConflict: 'hash', ignoreDuplicates: true }).select('id')
  if (error) { console.error('ERROR upsert:', error.message); process.exit(1) }
  inserted += data?.length ?? 0
}
console.log(`Записано новых примеров: ${inserted} (дубли пропущены)`)
