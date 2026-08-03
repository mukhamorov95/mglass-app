import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { digits10, normalizePhone } from '@/lib/onlinepbx'
import { notifyAdmins } from '@/lib/telegram'

// Вебхук OnlinePBX: события звонков (входящие/исходящие/пропущенные) и ссылки на
// записи → в ленту лида (crm_lead_events kind='call'). API-ключ здесь НЕ нужен —
// АТС сама шлёт события. Путь в whitelist middleware; защита — секрет в query
// (?key=ONLINEPBX_WEBHOOK_SECRET).
//
// Настройка на стороне АТС (Настройка АТС → модуль «HTTP-запрос», ставить в
// конце схемы / на завершение звонка): POST на
//   {NEXT_PUBLIC_APP_URL}/api/onlinepbx/webhook?key=<секрет>
// с полями (имена гибкие — ниже списки синонимов): номер клиента, линия/DID,
// внутренний оператора, направление, статус, длительность, ссылка на запись,
// id звонка. Лучше слать ОДИН запрос на завершённый звонок — тогда одна запись
// в ленте; дубли по одному id отсекаются.

type Flat = Record<string, string>

function flatten(obj: unknown, out: Flat, prefix = '') {
  if (!obj || typeof obj !== 'object') return
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = (prefix ? `${prefix}.${k}` : k).toLowerCase()
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, out, key)
    else if (v != null) out[key] = String(v)
  }
}

async function parsePayload(req: NextRequest): Promise<Flat> {
  const out: Flat = {}
  req.nextUrl.searchParams.forEach((v, k) => { out[k.toLowerCase()] = v })
  const ct = req.headers.get('content-type') || ''
  try {
    if (ct.includes('application/json')) {
      flatten(await req.json(), out)
    } else if (ct.includes('form')) {
      const fd = await req.formData()
      fd.forEach((v, k) => { out[k.toLowerCase()] = String(v) })
    } else {
      const t = (await req.text()).trim()
      if (t.startsWith('{')) flatten(JSON.parse(t), out)
    }
  } catch { /* пустое/битое тело — ниже отдадим skipped */ }
  return out
}

// Достаём значение по первому непустому синониму (учитывая вложенные data./call.)
function pick(f: Flat, keys: string[]): string {
  for (const k of keys) {
    for (const [fk, fv] of Object.entries(f)) {
      if ((fk === k || fk.endsWith('.' + k)) && fv && fv.trim()) return fv.trim()
    }
  }
  return ''
}

const PHONE_KEYS = ['caller_id_number', 'caller_id', 'caller', 'contact', 'client', 'from', 'src', 'external', 'phone', 'number', 'abonent']
const EXT_KEYS = ['operator', 'ext', 'extension', 'internal', 'user', 'answered_by', 'accountcode']
const DIR_KEYS = ['direction', 'call_type', 'type']
const STATUS_KEYS = ['status', 'disposition', 'result', 'event', 'hangup_cause', 'call_status']
const DUR_KEYS = ['billsec', 'talk_time', 'duration', 'seconds', 'talktime']
const REC_KEYS = ['record_url', 'download_url', 'recording', 'record', 'audio', 'file', 'link']
const ID_KEYS = ['call_id', 'callid', 'uuid', 'session', 'id']

function fmtDur(sec: number): string {
  if (!sec || sec < 0) return '0:00'
  const m = Math.floor(sec / 60), s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function fmtPhone(d10: string): string {
  return d10.length === 10 ? `+7 (${d10.slice(0, 3)}) ${d10.slice(3, 6)}-${d10.slice(6, 8)}-${d10.slice(8)}` : d10
}

export async function GET() {
  return NextResponse.json({ ok: true, service: 'onlinepbx-webhook' })
}

export async function POST(req: NextRequest) {
  const secret = process.env.ONLINEPBX_WEBHOOK_SECRET
  if (secret && req.nextUrl.searchParams.get('key') !== secret) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const f = await parsePayload(req)

  const phoneRaw = pick(f, PHONE_KEYS)
  const d10 = digits10(phoneRaw)
  if (d10.length !== 10) return NextResponse.json({ ok: true, skipped: 'no_external_phone' })

  const dir = pick(f, DIR_KEYS).toLowerCase()
  const outbound = /out|исход/.test(dir)
  const statusRaw = pick(f, STATUS_KEYS).toLowerCase()
  const duration = parseInt(pick(f, DUR_KEYS) || '0', 10) || 0
  const record = pick(f, REC_KEYS)
  const callId = pick(f, ID_KEYS)
  const ext = pick(f, EXT_KEYS)

  // Пропущенный: явный статус без ответа ИЛИ входящий с нулевой длительностью и
  // без записи. Отвеченный: есть длительность/запись или статус «answered».
  const missed = /miss|noanswer|no-answer|no_answer|unanswer|cancel|busy|fail|reject|пропущ|неотвеч|занят|отбой/.test(statusRaw)
    || (!outbound && duration === 0 && !record && !/answer|bridge|complete|отвеч/.test(statusRaw))

  const phoneNorm = normalizePhone(phoneRaw)
  const sb = createServiceClient()

  // Атомарный барьер идемпотентности. АТС ретраит вебхук — раньше SELECT-дедуп
  // проигрывал гонку (6 запросов за 270 мс одновременно видели «дубля нет» и все
  // вставляли лид+событие → фантомные лиды и дубли-звонки). Теперь первый запрос
  // «занимает» call_id вставкой в crm_processed_calls (PK), а ретраи ловят
  // конфликт уникальности и выходят ДО создания лида/события.
  if (callId) {
    const { error: claimErr } = await sb.from('crm_processed_calls').insert({ call_id: callId })
    if (claimErr) return NextResponse.json({ ok: true, duplicate: true })
  }

  // Ищем лид по номеру: быстрый путь ILIKE по 10 цифрам, иначе скан с
  // нормализацией в JS (номера в базе бывают с +7/8/скобками).
  let lead = await findLeadByPhone(sb, d10)

  // Режим приёма лидов (тумблер на /crm, owner_strategy.crm_ingest_mode):
  // 'avito_only' — звонки с неизвестных номеров НЕ создают лид (события по
  // существующим лидам продолжают писаться). По умолчанию — 'all'.
  let ingestAll = true
  try {
    const { data: mode } = await sb.from('owner_strategy').select('value').eq('key', 'crm_ingest_mode').maybeSingle()
    ingestAll = (mode as { value?: string } | null)?.value !== 'avito_only'
  } catch { /* нет строки/таблицы — принимаем всё */ }

  // Входящий на неизвестный номер — заводим лид (клиент не потеряется в воронке).
  let created = false
  if (!lead && !outbound && ingestAll) {
    const { data } = await sb.from('crm_leads')
      .insert({ source: 'call', phone: phoneNorm, manager: null })
      .select('id,manager,name').maybeSingle()
    lead = data as LeadRow | null
    created = true
    if (lead) await sb.from('crm_lead_events').insert({ lead_id: lead.id, kind: 'system', text: 'Лид создан из входящего звонка', author: null })
  }
  if (!lead) return NextResponse.json({ ok: true, no_lead: true })
  if (callId) await sb.from('crm_processed_calls').update({ lead_id: lead.id }).eq('call_id', callId).then(() => {}, () => {})

  const arrow = outbound ? 'Исходящий' : 'Входящий'
  const text = missed
    ? `📵 ${outbound ? 'Не дозвонились' : 'Пропущенный звонок'} · ${fmtPhone(d10)}`
    : `📞 ${arrow} звонок · ${fmtPhone(d10)}${duration ? ` · ${fmtDur(duration)}` : ''}`

  const meta = { call_id: callId || null, direction: outbound ? 'out' : 'in', duration, record: record || null, ext: ext || null }
  const row = { lead_id: lead.id, kind: 'call', text, author: null, meta }
  const { error } = await sb.from('crm_lead_events').insert(row)
  if (error && /meta/i.test(error.message || '')) {
    // колонка meta ещё не добавлена — пишем без неё, ссылку кладём в текст
    await sb.from('crm_lead_events').insert({
      lead_id: lead.id, kind: 'call', author: null,
      text: text + (record ? `\n▶ Запись: ${record}` : ''),
    })
  }
  await sb.from('crm_leads').update({ updated_at: new Date().toISOString() }).eq('id', lead.id)

  // Пропущенный входящий — пингуем, чтобы перезвонили быстро.
  if (missed && !outbound) {
    await notifyAdmins([
      '📵 <b>Пропущенный звонок</b>',
      fmtPhone(d10),
      lead.name ? `Клиент: ${lead.name}` : (created ? 'Новый клиент (лид создан)' : ''),
      'Карточка: https://mglass-app.vercel.app/crm/' + lead.id,
    ].filter(Boolean).join('\n')).catch(() => {})
  }

  return NextResponse.json({ ok: true, lead_id: lead.id, missed, created })
}

type LeadRow = { id: number; manager: string | null; name: string | null }

async function findLeadByPhone(sb: ReturnType<typeof createServiceClient>, d10: string): Promise<LeadRow | null> {
  // Быстрый путь: телефон в базе содержит эти 10 цифр подряд (частый случай:
  // +7XXXXXXXXXX / 8XXXXXXXXXX / XXXXXXXXXX без разделителей).
  const { data: fast } = await sb.from('crm_leads')
    .select('id,manager,name').ilike('phone', `%${d10}%`).order('id', { ascending: false }).limit(1)
  if (fast && fast.length) return fast[0] as LeadRow

  // Медленный путь: номера с разделителями — нормализуем в JS.
  const { data: rows } = await sb.from('crm_leads')
    .select('id,manager,name,phone').not('phone', 'is', null).order('id', { ascending: false }).limit(4000)
  const hit = ((rows ?? []) as (LeadRow & { phone: string })[]).find(r => digits10(r.phone) === d10)
  return hit ? { id: hit.id, manager: hit.manager, name: hit.name } : null
}
