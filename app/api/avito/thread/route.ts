import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { getSessionUser } from '@/lib/getRole'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { isAvitoConfigured, avitoGetSelfId, avitoListMessages, avitoSendMessage } from '@/lib/avito'
import { saveManagerExample, clientContextFromHistory } from '@/lib/avito/managerExamples'

// Переписка с клиентом Авито прямо из CRM: GET — живая история диалога,
// POST — отправить сообщение (и «забрать» лид у Ивана: manager = менеджер).

const AI_MANAGERS = ['Иван (AI)', 'AI-менеджер']

async function leadChatId(sb: ReturnType<typeof createServiceClient>, leadId: number) {
  const { data } = await sb.from('crm_leads').select('id,avito_chat_id,manager,product,status').eq('id', leadId).maybeSingle()
  return data as { id: number; avito_chat_id: string | null; manager: string | null; product: string | null; status: string | null } | null
}

async function myName(): Promise<string | null> {
  const user = await getSessionUser()
  if (!user) return null
  const supabase = await createClient()
  const { data } = await supabase.from('users').select('name').eq('id', user.id).maybeSingle()
  return (data as { name: string | null } | null)?.name ?? user.email ?? null
}

export async function GET(req: NextRequest) {
  const guard = await requireRole(['admin', 'ceo', 'commercial', 'manager'])
  if (guard instanceof NextResponse) return guard
  const leadId = Number(new URL(req.url).searchParams.get('lead_id'))
  if (!leadId) return NextResponse.json({ error: 'no lead_id' }, { status: 400 })
  if (!isAvitoConfigured()) return NextResponse.json({ error: 'Авито не настроен' }, { status: 400 })

  const sb = createServiceClient()
  const lead = await leadChatId(sb, leadId)
  if (!lead?.avito_chat_id) return NextResponse.json({ messages: [], noChat: true })

  try {
    const selfId = await avitoGetSelfId()
    const raw = await avitoListMessages(selfId, lead.avito_chat_id, { limit: 100 })
    const messages = raw
      .map(m => ({
        id: m.id,
        from: (m.direction === 'out' || m.author_id === selfId) ? 'us' : 'client',
        text: m.content?.text ?? '',
        created: m.created ?? 0,
      }))
      .filter(m => m.text.trim())
      .sort((a, b) => a.created - b.created)
    return NextResponse.json({ messages, manager: lead.manager })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }
}

export async function POST(req: NextRequest) {
  const guard = await requireRole(['admin', 'ceo', 'commercial', 'manager'])
  if (guard instanceof NextResponse) return guard
  if (!isAvitoConfigured()) return NextResponse.json({ error: 'Авито не настроен' }, { status: 400 })

  let body: { lead_id?: number; text?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }) }
  const leadId = Number(body.lead_id)
  const text = (body.text ?? '').trim()
  if (!leadId || !text) return NextResponse.json({ error: 'lead_id и text обязательны' }, { status: 400 })

  const sb = createServiceClient()
  const lead = await leadChatId(sb, leadId)
  if (!lead?.avito_chat_id) return NextResponse.json({ error: 'у лида нет чата Авито' }, { status: 400 })

  const me = await myName()
  try {
    const selfId = await avitoGetSelfId()
    await avitoSendMessage(selfId, lead.avito_chat_id, text)
  } catch (e) {
    return NextResponse.json({ error: 'Авито отклонил отправку: ' + (e as Error).message }, { status: 502 })
  }

  // Обучение бота (Фаза 3): фиксируем «на что ответил менеджер» ДО записи его
  // реплики в ленту. Fail-open — обучение не должно мешать отправке.
  try {
    const { data: evs } = await sb.from('crm_lead_events')
      .select('text').eq('lead_id', leadId).eq('kind', 'message')
      .order('id', { ascending: true }).limit(40)
    const context = clientContextFromHistory(((evs ?? []) as { text: string }[]).map(e => e.text))
    await saveManagerExample(sb, {
      lead_id: leadId, product: lead.product, client_context: context,
      manager_reply: text, won: lead.status === 'won',
    })
  } catch { /* обучение не критично */ }

  await sb.from('crm_lead_events').insert({ lead_id: leadId, kind: 'message', text: `МЕНЕДЖЕР: ${text}`, author: me })
  // Менеджер забрал диалог у AI — Иван больше не автоотвечает в этом чате.
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (!lead.manager || AI_MANAGERS.includes(lead.manager)) patch.manager = me
  await sb.from('crm_leads').update(patch).eq('id', leadId)

  return NextResponse.json({ ok: true, tookOver: !lead.manager || AI_MANAGERS.includes(lead.manager) })
}
