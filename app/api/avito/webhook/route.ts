import { NextRequest, NextResponse } from 'next/server'
import { createClient as svc } from '@supabase/supabase-js'
import { runAvitoManager, type DialogMsg, type LeadKnown } from '@/lib/ai-tools/avitoManagerRuntime'
import { avitoSendMessage, isAvitoConfigured } from '@/lib/avito'
import { notifyAdmins } from '@/lib/telegram'

// Вебхук Avito Messenger: входящее сообщение клиента → лид в crm_leads (по
// avito_chat_id) → AI-менеджер отвечает → снятые данные и скоринг в карточку.
// Путь в whitelist middleware; защита — секрет в query (?key=AVITO_WEBHOOK_SECRET).

function db() {
  return svc(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

type AvitoWebhook = {
  payload?: {
    type?: string
    value?: {
      id?: string
      chat_id?: string
      user_id?: number         // id нашего аккаунта
      author_id?: number       // кто написал
      content?: { text?: string }
      type?: string
      chat_type?: string
    }
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, configured: isAvitoConfigured() })
}

export async function POST(req: NextRequest) {
  const secret = process.env.AVITO_WEBHOOK_SECRET
  if (secret && req.nextUrl.searchParams.get('key') !== secret) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = (await req.json().catch(() => null)) as AvitoWebhook | null
  const v = body?.payload?.value
  // Отвечаем 200 на всё, чтобы Авито не ретраил бесконечно
  if (!v?.chat_id || body?.payload?.type !== 'message' || v.type !== 'text' || !v.content?.text) {
    return NextResponse.json({ ok: true, skipped: true })
  }
  // Эхо наших же сообщений — пропускаем
  if (v.author_id != null && v.user_id != null && v.author_id === v.user_id) {
    return NextResponse.json({ ok: true, echo: true })
  }

  const service = db()
  const text = v.content.text.slice(0, 4000)

  // Лид по чату: существующий или новый
  const { data: existing } = await service.from('crm_leads').select('*').eq('avito_chat_id', v.chat_id).maybeSingle()
  let lead = existing as Record<string, unknown> | null
  if (!lead) {
    const { data: created } = await service.from('crm_leads')
      .insert({ source: 'avito', avito_chat_id: v.chat_id, manager: 'Иван (AI)' })
      .select('*').single()
    lead = created as Record<string, unknown>
    await service.from('crm_lead_events').insert({ lead_id: lead.id, kind: 'system', text: 'Лид создан из Авито-чата', author: 'AI' })
  }
  const leadId = lead.id as number

  await service.from('crm_lead_events').insert({ lead_id: leadId, kind: 'message', text: `КЛИЕНТ: ${text}`, author: null })

  // История диалога из событий
  const { data: evs } = await service.from('crm_lead_events')
    .select('kind,text').eq('lead_id', leadId).eq('kind', 'message')
    .order('id', { ascending: true }).limit(40)
  const history: DialogMsg[] = ((evs ?? []) as { text: string }[]).map(e =>
    e.text.startsWith('БОТ: ')
      ? { from: 'manager', text: e.text.slice(5) }
      : { from: 'client', text: e.text.replace(/^КЛИЕНТ: /, '') })

  const known: LeadKnown = {
    name: lead.name as string | null, product: lead.product as string | null,
    sizes: lead.sizes as string | null, city: lead.city as string | null,
    budget: lead.budget as string | null, phone: lead.phone as string | null,
  }

  let turn
  try {
    turn = await runAvitoManager(history, known)
  } catch (e) {
    await service.from('crm_lead_events').insert({ lead_id: leadId, kind: 'system', text: `Ошибка AI: ${e instanceof Error ? e.message : e}`, author: 'AI' })
    return NextResponse.json({ ok: true, ai_error: true })
  }

  // Снятые данные — только заполняем пустое/обновляем непустым
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const k of ['name', 'product', 'sizes', 'city', 'budget', 'phone'] as const) {
    const val = turn.extracted[k]
    if (val && val !== lead[k]) patch[k] = val
  }
  if (turn.est_amount != null) patch.est_amount = turn.est_amount
  patch.score = turn.score
  patch.score_reason = turn.score_reason
  const becameQualified = turn.qualified && !lead.qualified
  if (turn.qualified) patch.qualified = true
  await service.from('crm_leads').update(patch).eq('id', leadId)

  // Ответ клиенту
  await service.from('crm_lead_events').insert({ lead_id: leadId, kind: 'message', text: `БОТ: ${turn.reply}`, author: 'AI' })
  if (isAvitoConfigured() && v.user_id != null) {
    try { await avitoSendMessage(v.user_id, v.chat_id, turn.reply) }
    catch (e) {
      await service.from('crm_lead_events').insert({ lead_id: leadId, kind: 'system', text: `Не отправлено в Авито: ${e instanceof Error ? e.message : e}`, author: 'AI' })
    }
  }

  // Горячий лид / нужен человек → Telegram
  if (becameQualified || turn.needs_human) {
    const title = becameQualified ? '⭐ <b>Горячий лид с Авито</b>' : '✋ <b>Авито: нужен человек</b>'
    const lines = [
      title,
      [turn.extracted.name ?? lead.name, turn.extracted.phone ?? lead.phone].filter(Boolean).join(' · '),
      [turn.extracted.product ?? lead.product, turn.extracted.sizes ?? lead.sizes].filter(Boolean).join(' · '),
      turn.est_amount != null ? `Предв. цена: ${Math.round(turn.est_amount).toLocaleString('ru-RU')} ₽` : '',
      `Скоринг: ${turn.score}/100 — ${turn.score_reason}`,
      '',
      'Карточка: https://mglass-app.vercel.app/crm',
    ].filter(Boolean)
    await notifyAdmins(lines.join('\n')).catch(() => {})
  }

  return NextResponse.json({ ok: true })
}
