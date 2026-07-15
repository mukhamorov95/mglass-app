// Перенос АКТИВНЫХ сделок воронки «Продажи» из AmoCRM в нашу CRM (crm_leads).
// По умолчанию DRY-RUN: показывает, что будет перенесено, ничего не пишет.
// Запуск:  node scripts/migrate-amo-to-crm.mjs            — прикидка
//          node scripts/migrate-amo-to-crm.mjs --apply    — перенос
// Повторный запуск безопасен: сделки, уже перенесённые (по note 'amo:<id>'), пропускаются.

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

const env = Object.fromEntries(readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
  .split('\n').filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]))

const APPLY = process.argv.includes('--apply')
const sub = env.AMO_SUBDOMAIN.includes('.') ? env.AMO_SUBDOMAIN : `${env.AMO_SUBDOMAIN}.amocrm.ru`
const amoHeaders = { Authorization: `Bearer ${env.AMO_ACCESS_TOKEN}` }

async function amo(path) {
  const res = await fetch(`https://${sub}/api/v4${path}`, { headers: amoHeaders })
  if (!res.ok) throw new Error(`${path}: ${res.status}`)
  return res.json()
}

// Воронка «Продажи» + маппинг статусов amo → наши этапы (имена совпадают по канону)
const pipelines = await amo('/leads/pipelines')
const sales = pipelines._embedded.pipelines.find(p => /продаж/i.test(p.name))
if (!sales) { console.error('Воронка «Продажи» не найдена'); process.exit(1) }
const stageById = new Map(sales._embedded.statuses.map(s => [s.id, s.name]))
console.log(`Воронка «${sales.name}», этапов: ${stageById.size}`)

const users = await amo('/users?limit=250').then(j => new Map(j._embedded.users.map(u => [u.id, u.name])))

// Активные сделки (не выиграна 142 / не закрыта 143)
let page = 1, leads = []
for (;;) {
  const j = await amo(`/leads?filter[pipeline_id]=${sales.id}&with=contacts&limit=250&page=${page}`)
  const chunk = j._embedded?.leads ?? []
  leads.push(...chunk.filter(l => l.status_id !== 142 && l.status_id !== 143))
  if (!j._links?.next || chunk.length === 0) break
  page++
}
console.log(`Активных сделок к переносу: ${leads.length}`)

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const { data: existing } = await sb.from('crm_leads').select('note').ilike('note', 'amo:%')
const done = new Set((existing ?? []).map(r => (r.note.match(/^amo:(\d+)/) ?? [])[1]).filter(Boolean))

let inserted = 0, skipped = 0
for (const l of leads) {
  if (done.has(String(l.id))) { skipped++; continue }
  const stage = stageById.get(l.status_id) ?? 'Получена новая заявка'
  const row = {
    source: 'manual',
    name: l.name || `Сделка amo #${l.id}`,
    stage,
    est_amount: l.price || null,
    manager: users.get(l.responsible_user_id) ?? null,
    note: `amo:${l.id}`,
    created_at: new Date(l.created_at * 1000).toISOString(),
  }
  if (APPLY) {
    const { error } = await sb.from('crm_leads').insert(row)
    if (error) { console.error(`#${l.id}: ${error.message}`); continue }
  } else {
    console.log(`→ ${row.name} · ${stage} · ${row.manager ?? '—'} · ${row.est_amount ?? 0} ₽`)
  }
  inserted++
}
console.log(APPLY ? `Перенесено: ${inserted}, пропущено (уже были): ${skipped}` : `Будет перенесено: ${inserted}, уже перенесено ранее: ${skipped}`)
if (!APPLY) console.log('Это была прикидка. Для переноса: node scripts/migrate-amo-to-crm.mjs --apply')
