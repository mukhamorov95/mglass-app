import { NextRequest, NextResponse } from 'next/server'
import { createClient as svc } from '@supabase/supabase-js'
import { runAvitoManager, type DialogMsg, type LeadKnown } from '@/lib/ai-tools/avitoManagerRuntime'
import { avitoSendMessage, isAvitoConfigured } from '@/lib/avito'
import { notifyAdmins } from '@/lib/telegram'
import { isBotEnabled } from '@/lib/aiKillSwitch'

// Вебхук Avito Messenger: входящее сообщение клиента → лид в crm_leads (по
// avito_chat_id) → AI-менеджер отвечает → снятые данные и скоринг в карточку.
// Путь в whitelist middleware; защита — секрет в query (?key=AVITO_WEBHOOK_SECRET).

// Даём первому вызову время завершить ответ модели, чтобы ретрай Авито успел
// прийти к уже помеченному сообщению и был отсеян дедупом (не двойной ответ).
export const maxDuration = 60

// Имена «AI ведёт чат» — при них Иван автоотвечает. Любой другой ответственный =
// чат забрал человек, Иван молчит. Легаси «Максим» убран: он пересекался с
// реальным человеком по имени Максим (тот забирал чат, а бот продолжал отвечать).
const AI_MANAGERS = ['Иван (AI)', 'AI-менеджер']

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
  if (!v?.chat_id || body?.payload?.type !== 'message') {
    return NextResponse.json({ ok: true, skipped: true })
  }
  // Эхо наших же сообщений — пропускаем
  if (v.author_id != null && v.user_id != null && v.author_id === v.user_id) {
    return NextResponse.json({ ok: true, echo: true })
  }

  const service = db()

  // Идемпотентность: каждое сообщение Авито обрабатываем РОВНО один раз (Авито
  // ретраит вебхук → без дедупа Иван отвечал по 2–4 раза). Ключ — id сообщения;
  // если id нет — синтезируем из чата+текста, чтобы дедуп не отключался.
  const rawText = v.content?.text ?? ''
  const msgKey = v.id || `${v.chat_id}|${rawText.length}|${rawText.slice(0, 80)}`
  const { data: fresh } = await service.from('avito_processed_messages')
    .upsert({ msg_id: msgKey }, { onConflict: 'msg_id', ignoreDuplicates: true })
    .select('msg_id')
  if (!fresh || fresh.length === 0) return NextResponse.json({ ok: true, duplicate: true })

  // ЛИД СОЗДАЁМ ПЕРВЫМ ДЕЛОМ — до разбора типа сообщения.
  //
  // Раньше проверка «не текст» стояла ВЫШЕ создания лида и для нового чата
  // искала лид, которого ещё нет: сообщение помечалось обработанным и исчезало.
  // За 23–29.07 так потерялось 349 обращений с Авито — вебхук принимал их
  // ежедневно (до 96 в день), а в CRM не попало ни одного. Теперь любое
  // обращение сначала становится видимым лидом, и только потом разбирается.
  const { data: found } = await service.from('crm_leads').select('*')
    .eq('avito_chat_id', v.chat_id).order('id', { ascending: true }).limit(1)
  let lead = (found?.[0] ?? null) as Record<string, unknown> | null
  if (!lead) {
    const { data: created } = await service.from('crm_leads')
      .upsert({ source: 'avito', avito_chat_id: v.chat_id, manager: 'Иван (AI)' }, { onConflict: 'avito_chat_id', ignoreDuplicates: true })
      .select('*')
    lead = (created?.[0] ?? null) as Record<string, unknown> | null
    if (lead) {
      await service.from('crm_lead_events').insert({ lead_id: lead.id, kind: 'system', text: 'Лид создан из Авито-чата', author: 'AI' })
    } else {
      // Конкурентная вставка выиграла — перечитываем существующий лид.
      const { data: re } = await service.from('crm_leads').select('*')
        .eq('avito_chat_id', v.chat_id).order('id', { ascending: true }).limit(1)
      lead = (re?.[0] ?? null) as Record<string, unknown> | null
    }
  }
  if (!lead) return NextResponse.json({ ok: true, no_lead: true })
  const leadId = lead.id as number

  // Не-текст (фото/голос/файл) ИЛИ неизвестный формат от Авито. Лид уже есть,
  // поэтому обращение видно в CRM в любом случае. В ленту пишем, что именно
  // пришло — по этой записи видно, если Авито снова сменит формат payload.
  if (v.type !== 'text' || !rawText.trim()) {
    const what = v.type && v.type !== 'text' ? `вложение (${v.type})` : `сообщение без текста (type=${v.type ?? '—'})`
    await service.from('crm_lead_events').insert({
      lead_id: leadId, kind: 'message', author: null,
      text: `КЛИЕНТ: 📎 ${what} — открой чат в приложении Авито`,
    })
    await service.from('crm_leads').update({ updated_at: new Date().toISOString() }).eq('id', leadId)
    await notifyAdmins([
      '📎 <b>Авито: обращение без текста</b>',
      'Иван это не обработает — нужен человек.',
      `Карточка: https://mglass-app.vercel.app/crm/${leadId}`,
    ].join('\n')).catch(() => {})
    return NextResponse.json({ ok: true, non_text: true, type: v.type ?? null })
  }
  const text = rawText.slice(0, 4000)

  await service.from('crm_lead_events').insert({ lead_id: leadId, kind: 'message', text: `КЛИЕНТ: ${text}`, author: null })

  // Клиент ответил — счётчик напоминаний обнуляем, id аккаунта запоминаем:
  // без него фоллоу-ап (крон avito-followup) не сможет написать в этот чат.
  const followupPatch: Record<string, unknown> = { followup_count: 0 }
  if (v.user_id != null && lead.avito_user_id !== v.user_id) followupPatch.avito_user_id = v.user_id
  await service.from('crm_leads').update(followupPatch).eq('id', leadId)

  // Диалог ведёт ЧЕЛОВЕК (менеджер забрал у Ивана или лид импортирован) — Иван
  // не автоотвечает, чтобы клиенту не писали оба. Фиксируем сообщение и пингуем.
  const managerName = (lead.manager as string | null) ?? null
  if (managerName && !AI_MANAGERS.includes(managerName)) {
    await notifyAdmins([
      '💬 <b>Авито: новое сообщение от клиента</b>',
      `Ведёт: ${managerName}`,
      `Клиент: ${text.slice(0, 200)}`,
      `Карточка: https://mglass-app.vercel.app/crm/${leadId}`,
    ].join('\n')).catch(() => {})
    return NextResponse.json({ ok: true, human_handling: true })
  }

  // Kill-switch с /vladislav: бот выключен — сообщение сохранено выше, отвечает человек.
  if (!(await isBotEnabled(service))) {
    await notifyAdmins([
      '🔕 <b>Авито: сообщение клиента (бот ВЫКЛЮЧЕН)</b>',
      `Клиент: ${text.slice(0, 200)}`,
      `Карточка: https://mglass-app.vercel.app/crm/${leadId}`,
    ].join('\n')).catch(() => {})
    return NextResponse.json({ ok: true, bot_disabled: true })
  }

  // История диалога — ПОСЛЕДНИЕ 40 сообщений в хронологическом порядке.
  const { data: evs } = await service.from('crm_lead_events')
    .select('kind,text').eq('lead_id', leadId).eq('kind', 'message')
    .order('id', { ascending: false }).limit(40)
  const history: DialogMsg[] = (((evs ?? []) as { text: string }[]).reverse()).map(e =>
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
    // Ошибка модели ДО отправки — снимаем метку дедупа, чтобы ретрай Авито
    // переобработал сообщение (иначе ответ был бы потерян навсегда).
    await service.from('avito_processed_messages').delete().eq('msg_id', msgKey)
    await service.from('crm_lead_events').insert({ lead_id: leadId, kind: 'system', text: `Ошибка AI: ${e instanceof Error ? e.message : e}`, author: 'AI' })
    return NextResponse.json({ ok: false, ai_error: true }, { status: 500 })
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

  // Перепроверка перед отправкой: не забрал ли чат человек за время работы модели.
  const { data: cur } = await service.from('crm_leads').select('manager').eq('id', leadId).maybeSingle()
  const curMgr = (cur as { manager: string | null } | null)?.manager ?? null
  if (curMgr && !AI_MANAGERS.includes(curMgr)) {
    await service.from('crm_lead_events').insert({ lead_id: leadId, kind: 'system', text: `Автоответ Ивана отменён — чат забрал ${curMgr}`, author: 'AI' })
    return NextResponse.json({ ok: true, taken_over: true })
  }

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
      `Карточка: https://mglass-app.vercel.app/crm/${leadId}`,
    ].filter(Boolean)
    await notifyAdmins(lines.join('\n')).catch(() => {})
  }

  return NextResponse.json({ ok: true })
}
