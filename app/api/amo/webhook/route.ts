import { NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { sendMessage, getChannels } from '@/lib/wazzup'

const AMO_BASE = `https://${process.env.AMO_SUBDOMAIN}.amocrm.ru/api/v4`
const AMO_TOKEN = process.env.AMO_ACCESS_TOKEN!
const VLADISLAV_USER_ID = parseInt(process.env.AMO_VLADISLAV_USER_ID || '8352283')

const ROUND_ROBIN_ENABLED = process.env.AMOCRM_ROUND_ROBIN_ENABLED === 'true'
const ROUND_ROBIN_MANAGERS: number[] = (process.env.AMOCRM_MANAGERS_IDS ?? '')
  .split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n) && n > 0)

const STAGE_MEASUREMENT_SCHEDULED = process.env.AMO_STAGE_MEASUREMENT_ID
  ? parseInt(process.env.AMO_STAGE_MEASUREMENT_ID)
  : null

const STAGE_ASSIGNED = 48587215

const FIRST_MESSAGE = `Здравствуйте! Меня зовут Владислав, я менеджер компании MGlass.

Вы оставили заявку на изготовление — уточните, пожалуйста, что именно вас интересует? Зеркало с подсветкой, душевая перегородка или лофт-перегородка?`

const MEASUREMENT_CONFIRMATION = `Отлично! Замер у вас назначен. Наш мастер приедет в согласованное время.

Если появятся вопросы — пишите сюда, всегда на связи 🙂`

// ── AMO won/lost status IDs ──────────────────────────────────────────────────
const AMO_WON_STATUS  = 142
const AMO_LOST_STATUS = 143

function supabase() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// ── Normalize phone to 7XXXXXXXXXX format ────────────────────────────────────
// Handles: +7, 8, 10-digit local, any separator chars
function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('8')) return '7' + digits.slice(1)
  if (digits.length === 11 && digits.startsWith('7')) return digits
  if (digits.length === 10) return '7' + digits
  return null  // not a valid Russian number
}

// ── AMO helpers ───────────────────────────────────────────────────────────────
async function amoGet(path: string) {
  const res = await fetch(`${AMO_BASE}${path}`, {
    headers: { Authorization: `Bearer ${AMO_TOKEN}` },
    cache: 'no-store',
  })
  if (!res.ok || res.status === 204) return null
  return res.json()
}

async function addAmoNote(leadId: number, text: string) {
  await fetch(`${AMO_BASE}/leads/${leadId}/notes`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${AMO_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([{ note_type: 'common', params: { text } }]),
  })
}

async function assignLeadToManager(leadId: number, managerId: number) {
  await fetch(`${AMO_BASE}/leads`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${AMO_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([{ id: leadId, responsible_user_id: managerId, status_id: STAGE_ASSIGNED }]),
  })
}

async function getDefaultChannel(): Promise<{ channelId: string; chatType: string } | null> {
  try {
    const data = await getChannels()
    const channels = data?.channels ?? []
    const active = channels.find((c: { state?: string }) => c.state === 'active')
    if (!active) return null
    return { channelId: active.id, chatType: active.transport ?? 'whatsapp' }
  } catch {
    return null
  }
}

// ── Get all normalized phones + contact IDs from a lead's contacts ────────────
type ContactInfo = { phones: string[]; name: string; contactIds: number[] }

async function getLeadContactInfo(leadId: number): Promise<ContactInfo> {
  const data = await amoGet(`/leads/${leadId}?with=contacts`)
  const contacts: { id: number }[] = data?._embedded?.contacts ?? []
  const phones: string[] = []
  const contactIds: number[] = []
  let name = ''

  for (const c of contacts) {
    contactIds.push(c.id)
    const contactData = await amoGet(`/contacts/${c.id}`)
    if (!contactData) continue
    if (!name) name = contactData.name ?? ''

    const fields: { field_code?: string; values?: { value?: unknown }[] }[] = contactData.custom_fields_values ?? []
    const phoneField = fields.find(f => f.field_code === 'PHONE')
    for (const pv of phoneField?.values ?? []) {
      const norm = normalizePhone(pv.value as string)
      if (norm && !phones.includes(norm)) phones.push(norm)
    }
  }

  return { phones, name, contactIds }
}

// ── 1. Check local DB for existing ownership ─────────────────────────────────
async function findOwnerInLocalDb(phones: string[]): Promise<number | null> {
  if (!phones.length) return null
  const db = supabase()
  const { data } = await db
    .from('client_ownership')
    .select('manager_id')
    .in('phone', phones)
    .order('updated_at', { ascending: false })
    .limit(1)
  return (data?.[0]?.manager_id as number) ?? null
}

// ── 2. Search AMO contacts/leads for existing manager ─────────────────────────
// Returns the most recent active/won manager for this phone
async function findOwnerInAmo(phones: string[]): Promise<number | null> {
  for (const phone of phones) {
    const data = await amoGet(`/contacts?query=${encodeURIComponent(phone)}&with=leads&limit=5`)
    const contacts: { _embedded?: { leads?: { id: number }[] } }[] = data?._embedded?.contacts ?? []
    if (!contacts.length) continue

    // Collect all lead IDs from contacts found by this phone
    const leadIds: number[] = []
    for (const contact of contacts) {
      for (const l of contact._embedded?.leads ?? []) {
        if (!leadIds.includes(l.id)) leadIds.push(l.id)
      }
    }
    if (!leadIds.length) continue

    // Batch-fetch leads (up to 20)
    const idsParam = leadIds.slice(0, 20).map(id => `filter[id][]=${id}`).join('&')
    const leadsData = await amoGet(`/leads?${idsParam}`)
    const leads: { status_id: number; responsible_user_id: number; created_at?: number }[] = leadsData?._embedded?.leads ?? []
    if (!leads.length) continue

    // Prioritize: active deal > won deal > any, then most recent
    const scored = leads.map(l => {
      const isActive = l.status_id !== AMO_WON_STATUS && l.status_id !== AMO_LOST_STATUS
      const isWon   = l.status_id === AMO_WON_STATUS
      const score   = isActive ? 2 : isWon ? 1 : 0
      return { managerId: l.responsible_user_id as number, score, createdAt: l.created_at as number ?? 0 }
    })

    scored.sort((a, b) => b.score - a.score || b.createdAt - a.createdAt)
    if (scored[0]?.managerId) return scored[0].managerId
  }

  return null
}

// ── Save / update ownership in local DB ──────────────────────────────────────
async function saveOwnership(phones: string[], managerId: number, contactId?: number) {
  if (!phones.length) return
  const db = supabase()
  for (const phone of phones) {
    await db.from('client_ownership').upsert(
      {
        phone,
        contact_id: contactId ?? null,
        manager_id: managerId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'phone' }
    )
  }
}

// ── Round-robin (only for new clients) ───────────────────────────────────────
async function getNextRoundRobinManager(): Promise<number | null> {
  if (!ROUND_ROBIN_ENABLED || !ROUND_ROBIN_MANAGERS.length) return null
  const db = supabase()
  const { data } = await db.from('ai_settings').select('value').eq('key', 'round_robin_index').single()
  const idx = parseInt(data?.value ?? '0') || 0
  const managerId = ROUND_ROBIN_MANAGERS[idx % ROUND_ROBIN_MANAGERS.length]
  const nextIdx = (idx + 1) % ROUND_ROBIN_MANAGERS.length
  await db.from('ai_settings').upsert({ key: 'round_robin_index', value: String(nextIdx), updated_at: new Date().toISOString() })
  return managerId
}

// ── Start AI bot conversation — DISABLED ─────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function handleNewLead(_leadId: number, _managerId: number, _phone: string | null, _clientName: string) {
  // Bot is temporarily disabled — remove this guard when ready to re-enable
  return
}

// ── Stage change → send measurement confirmation ──────────────────────────────
async function handleStageChange(leadId: number, newStatusId: number) {
  if (!STAGE_MEASUREMENT_SCHEDULED || newStatusId !== STAGE_MEASUREMENT_SCHEDULED) return
  const db = supabase()
  const { data: chat } = await db
    .from('ai_managed_chats')
    .select()
    .eq('amo_lead_id', leadId)
    .single()
  if (!chat) return
  await sendMessage(chat.channel_id, chat.chat_id, chat.chat_type, MEASUREMENT_CONFIRMATION)
  await db.from('ai_conversations').insert({ chat_id: chat.chat_id, role: 'assistant', content: MEASUREMENT_CONFIRMATION })
}

// ── Main webhook handler ──────────────────────────────────────────────────────
export async function POST(_req: Request) {
  // All AMO automation disabled — return 200 so AMO doesn't retry
  return NextResponse.json({ ok: true })

  try {
    const contentType = (_req as Request).headers.get('content-type') ?? ''
    let body: Record<string, unknown> = {}

    if (contentType.includes('application/json')) {
      body = await (_req as Request).json()
    } else {
      const text = await (_req as Request).text()
      const params = new URLSearchParams(text)
      for (const [key, value] of params.entries()) body[key] = value
    }

    for (const [key, value] of Object.entries(body)) {

      // ── New lead ──────────────────────────────────────────────────────────
      if (key.startsWith('leads[add]') && key.endsWith('[id]')) {
        const leadId = parseInt(value as string)
        if (!leadId) continue

        const lead = await amoGet(`/leads/${leadId}`)
        if (!lead) continue

        const { phones, name, contactIds } = await getLeadContactInfo(leadId)

        // ── Ownership check: local DB first, then AMO ─────────────────────
        let existingManager = await findOwnerInLocalDb(phones)

        if (!existingManager) {
          existingManager = await findOwnerInAmo(phones)
        }

        const managerId: number = lead.responsible_user_id
        let note: string

        if (existingManager) {
          // Returning client → assign to existing manager, skip round-robin
          // Returning client — log only, no auto-assign (disabled)
          note = [
            `🔁 Повторный клиент`,
            `Предыдущий менеджер: ID ${existingManager}`,
            phones.length ? `Совпадение по телефону: ${phones[0]}` : `Совпадение по контакту`,
            `⚠️ Авто-назначение отключено — назначьте менеджера вручную`,
          ].join('\n')
        } else {
          // New client — log only, no round-robin (disabled)
          note = [
            `🆕 Новый клиент`,
            `⚠️ Авто-распределение отключено — назначьте менеджера вручную`,
          ].join('\n')
        }

        // Save ownership for all found phones
        await saveOwnership(phones, managerId, contactIds[0])
        await addAmoNote(leadId, note)

        // Start AI conversation if assigned to Vladislav
        await handleNewLead(leadId, managerId, phones[0] ?? null, name)
      }

      // ── Stage change ──────────────────────────────────────────────────────
      if (key.startsWith('leads[status]') && key.endsWith('[id]')) {
        const leadId = parseInt(value as string)
        const statusId = parseInt(body[key.replace('[id]', '[status_id]')] as string)
        if (leadId && statusId) await handleStageChange(leadId, statusId)
      }

      // ── Responsible user changed → if was bot → pause bot ────────────────
      if (key.startsWith('leads[update]') && key.endsWith('[id]')) {
        const leadId = parseInt(value as string)
        const newResponsible = parseInt(body[key.replace('[id]', '[responsible_user_id]')] as string)
        if (leadId && newResponsible && newResponsible !== VLADISLAV_USER_ID) {
          const db = supabase()
          const { data: chat } = await db
            .from('ai_managed_chats')
            .select('is_active, chat_id')
            .eq('amo_lead_id', leadId)
            .maybeSingle()
          if (chat?.is_active) {
            await db.from('ai_managed_chats').update({
              is_active: false,
              close_reason: 'manager_took_over',
            }).eq('amo_lead_id', leadId)
            await addAmoNote(leadId, `⏸ AI-бот остановлен — менеджер взял диалог (ID ${newResponsible})`)
          }
        }
      }
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('AMO webhook error:', err)
    return NextResponse.json({ ok: false }, { status: 200 })
  }
}
