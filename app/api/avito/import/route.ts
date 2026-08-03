import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { createServiceClient } from '@/lib/supabase-service'
import { isAvitoConfigured, avitoGetSelfId, avitoListChats, avitoListMessages } from '@/lib/avito'
import { classifyAvitoDialog } from '@/lib/ai-tools/avitoLeadClassifier'
import { type DialogMsg } from '@/lib/ai-tools/avitoManagerRuntime'
import { scoreLead } from '@/lib/avito/scoreLead'
import { type LeadFlags } from '@/lib/avito/flags'

// Импорт существующих заявок Авито в CRM. GET — превью с классификацией
// (интересно/отказ), POST — вставка выбранных (кроме отказников) в crm_leads.
// Дедуп по avito_chat_id. Требует скоуп messenger:read у ключей Авито.

export const maxDuration = 60

// Пул с ограничением параллелизма — не заваливаем Avito API и Anthropic.
async function pool<T, R>(items: T[], size: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let idx = 0
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (idx < items.length) {
      const cur = idx++
      out[cur] = await fn(items[cur], cur)
    }
  }))
  return out
}

export async function GET(req: NextRequest) {
  const guard = await requireRole(['admin', 'ceo', 'commercial'])
  if (guard instanceof NextResponse) return guard
  if (!isAvitoConfigured()) {
    return NextResponse.json({ error: 'Авито не настроен (нет ключей AVITO_CLIENT_ID/SECRET)' }, { status: 400 })
  }

  const limit = Math.min(Number(new URL(req.url).searchParams.get('limit')) || 40, 100)

  try {
    const selfId = await avitoGetSelfId()
    const chats  = await avitoListChats(selfId, { limit })

    const sb = createServiceClient()
    const { data: existing } = await sb.from('crm_leads').select('avito_chat_id').not('avito_chat_id', 'is', null)
    const seen = new Set((existing ?? []).map(r => r.avito_chat_id as string))

    const candidates = await pool(chats, 4, async (chat) => {
      const already = seen.has(chat.id)
      const otherName = chat.users?.find(u => u.id !== selfId)?.name ?? ''
      const lastText  = chat.last_message?.content?.text ?? ''
      const title     = chat.context?.value?.title ?? ''

      if (already) {
        return { chat_id: chat.id, title, clientName: otherName, lastText,
          already_imported: true, status: 'interested' as const, reason: 'уже в CRM', extracted: {}, score: 0, flags: {} }
      }

      let history: DialogMsg[] = []
      try {
        const msgs = await avitoListMessages(selfId, chat.id, { limit: 50 })
        history = msgs.slice().reverse()
          .map(m => ({ from: (m.direction === 'out' || m.author_id === selfId ? 'manager' : 'client') as DialogMsg['from'], text: m.content?.text ?? '' }))
          .filter(m => m.text.trim())
      } catch { /* нет доступа к сообщениям — классифицируем по последнему */ }

      if (!history.length && lastText) history = [{ from: 'client', text: lastText }]

      const cls = await classifyAvitoDialog(history)
      return { chat_id: chat.id, title, clientName: otherName || cls.extracted.name || '', lastText,
        already_imported: false, status: cls.status, reason: cls.reason, extracted: cls.extracted, score: cls.score, flags: cls.flags }
    })

    return NextResponse.json({ selfId, scanned: chats.length, limit, candidates })
  } catch (e) {
    return NextResponse.json({
      error: (e as Error).message,
      hint: 'Если это 403/insufficient_scope — у ключей Авито нет права messenger:read на чтение чатов. Тогда импорт недоступен; заявки всё равно попадают в CRM через живой вебхук по мере поступления.',
    }, { status: 502 })
  }
}

type ImportItem = {
  chat_id: string; name?: string; phone?: string; product?: string
  sizes?: string; city?: string; budget?: string; score?: number; flags?: LeadFlags
}

export async function POST(req: NextRequest) {
  const guard = await requireRole(['admin', 'ceo', 'commercial'])
  if (guard instanceof NextResponse) return guard

  let body: { items?: ImportItem[] }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }) }
  const items = (body.items ?? []).filter(i => i.chat_id)
  if (!items.length) return NextResponse.json({ ok: true, inserted: 0 })

  const sb = createServiceClient()
  const { data: existing } = await sb.from('crm_leads').select('avito_chat_id').in('avito_chat_id', items.map(i => i.chat_id))
  const seen = new Set((existing ?? []).map(r => r.avito_chat_id as string))

  const toInsert = items.filter(i => !seen.has(i.chat_id)).map(i => {
    const flags = i.flags ?? {}
    const sc = scoreLead(flags)
    return {
      source: 'avito', avito_chat_id: i.chat_id, manager: 'Импорт с Авито',
      stage: 'Получена новая заявка',
      name: i.name || null, phone: i.phone || null, product: i.product || null,
      sizes: i.sizes || null, city: i.city || null, budget: i.budget || null,
      score: Number.isFinite(i.score) ? i.score : null,
      flags, readiness: sc.readiness, heat: sc.heat, missing_next: sc.missingNext,
      qualified: sc.isHot,
    }
  })
  if (!toInsert.length) return NextResponse.json({ ok: true, inserted: 0, skipped: items.length })

  const { data: inserted, error } = await sb.from('crm_leads').insert(toInsert).select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const events = (inserted ?? []).map(l => ({ lead_id: l.id, kind: 'system', text: 'Импортирован из Авито', author: 'Импорт' }))
  if (events.length) await sb.from('crm_lead_events').insert(events)

  return NextResponse.json({ ok: true, inserted: toInsert.length, skipped: items.length - toInsert.length })
}
