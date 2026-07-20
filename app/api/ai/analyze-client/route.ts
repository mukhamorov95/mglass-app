import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase-server'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

export type ClientAnalysis = {
  risk:           'low' | 'medium' | 'high'
  risk_reason:    string
  next_step:      string
  next_step_date: string | null   // ISO date suggestion, e.g. "+3 days"
  message_template: string
  summary:        string
}

function parseNotes(n: string | null): Record<string, unknown> {
  if (!n) return {}
  try { const p = JSON.parse(n); if (typeof p === 'object') return p } catch {}
  return {}
}

export async function POST(req: Request) {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { client_id } = await req.json() as { client_id: number }
  if (!client_id) return NextResponse.json({ error: 'client_id required' }, { status: 400 })

  // ── Load client data ───────────────────────────────────────────────────────
  const [{ data: client }, { data: interactions }, { data: orders }] = await Promise.all([
    sb.from('b2b_clients')
      .select('id,name,contact,phone,discount_percent,crm_segment,crm_status,crm_score,crm_city,crm_manager,crm_next_contact,crm_notes,notes,created_at')
      .eq('id', client_id)
      .single(),
    sb.from('b2b_interactions')
      .select('type,note,outcome,next_action,created_at')
      .eq('client_id', client_id)
      .order('created_at', { ascending: false })
      .limit(10),
    sb.from('b2b_orders')
      .select('total_after_discount,total_sale_inc_vat,discount_percent,margin_percent,created_at,notes')
      .eq('client_id', client_id)
      .order('created_at', { ascending: false })
      .limit(5),
  ])

  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

  // ── Build context ──────────────────────────────────────────────────────────
  const daysSinceContact = client.crm_next_contact
    ? Math.ceil((new Date(client.crm_next_contact).getTime() - Date.now()) / 86_400_000)
    : null

  const lastInteraction = interactions?.[0]
  const daysSinceLastInt = lastInteraction
    ? Math.floor((Date.now() - new Date(lastInteraction.created_at).getTime()) / 86_400_000)
    : null

  const ordersContext = (orders ?? []).map(o => ({
    date:     new Date(o.created_at).toLocaleDateString('ru-RU'),
    amount:   o.discount_percent > 0 ? o.total_after_discount : o.total_sale_inc_vat,
    discount: o.discount_percent,
    margin:   o.margin_percent,
    status:   parseNotes(o.notes).status ?? 'unknown',
  }))

  const totalRevenue = ordersContext.reduce((s, o) => s + (o.amount ?? 0), 0)
  const avgMargin    = ordersContext.length
    ? Math.round(ordersContext.reduce((s, o) => s + (o.margin ?? 0), 0) / ordersContext.length)
    : null

  const clientCtx = {
    id:           client.id,
    name:         client.name,
    segment:      client.crm_segment,
    status:       client.crm_status,
    score:        client.crm_score,
    city:         client.crm_city,
    manager:      client.crm_manager,
    discount:     `${client.discount_percent}%`,
    created:      new Date(client.created_at).toLocaleDateString('ru-RU'),
    crm_notes:    client.crm_notes,
    next_contact: client.crm_next_contact,
    days_to_contact: daysSinceContact,
    total_revenue:   totalRevenue,
    avg_margin:      avgMargin,
    orders:          ordersContext,
    recent_interactions: (interactions ?? []).map(i => ({
      type:    i.type,
      note:    i.note,
      outcome: i.outcome,
      date:    new Date(i.created_at).toLocaleDateString('ru-RU'),
    })),
    days_since_last_interaction: daysSinceLastInt,
  }

  // ── Prompt ─────────────────────────────────────────────────────────────────
  const prompt = `Ты CRM-аналитик компании MGlass (производство зеркал, душевых ограждений, лофт-перегородок в Москве).

Вот данные о B2B клиенте:
${JSON.stringify(clientCtx, null, 2)}

Сегодня: ${new Date().toLocaleDateString('ru-RU')}

Проанализируй и верни ответ строго в формате JSON (без markdown-блоков):
{
  "risk": "low" | "medium" | "high",
  "risk_reason": "1-2 предложения — почему этот уровень риска потери клиента",
  "next_step": "конкретное действие (позвонить, отправить КП, встретиться и т.д.)",
  "next_step_date": "через сколько дней — только число, например '2' или null если срочно",
  "message_template": "готовый текст сообщения для WhatsApp/звонка — персонализированный, учитывающий историю",
  "summary": "1 предложение общей оценки клиента"
}

Критерии риска:
- high: нет контакта > 30 дней, падение заказов, статус sleeping/lost, или next_contact сильно просрочен
- medium: последний контакт 15-30 дней назад, нерегулярные заказы, score B или ниже
- low: активные заказы, регулярные касания, score A, статус active/contacted`

  const msg = await anthropic.messages.create({
    model:      'claude-sonnet-5',
    max_tokens: 1024,
    system:     'Ты — CRM-аналитик. Отвечаешь только валидным JSON без markdown-блоков.',
    messages:   [{ role: 'user', content: prompt }],
  })

  const raw = msg.content[0].type === 'text' ? msg.content[0].text : '{}'
  try {
    const result: ClientAnalysis = JSON.parse(raw.replace(/```json\s*/gi, '').replace(/```/g, '').trim())
    return NextResponse.json(result)
  } catch {
    return NextResponse.json({
      risk:             'medium',
      risk_reason:      'Не удалось получить анализ от AI.',
      next_step:        'Проверьте данные клиента и попробуйте снова.',
      next_step_date:   null,
      message_template: '',
      summary:          'Анализ недоступен',
    } satisfies ClientAnalysis)
  }
}
