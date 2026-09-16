import { NextRequest, NextResponse } from 'next/server'
import { createClient as svc } from '@supabase/supabase-js'
import { runAvitoManager, type DialogMsg, type LeadKnown } from '@/lib/ai-tools/avitoManagerRuntime'
import { avitoSendMessage, isAvitoConfigured } from '@/lib/avito'
import { notifyAdmins } from '@/lib/telegram'
import { isBotEnabled } from '@/lib/aiKillSwitch'
import { decideNextAction } from '@/lib/avito/dispatcher'
import { FLAG_BY_KEY, type LeadFlags, type FlagKey } from '@/lib/avito/flags'
import { getRelevantExamples } from '@/lib/avito/managerExamples'
import { loadBotKnowledge, recordKnowledgeGap } from '@/lib/knowledge/aiKnowledge'
import { botGate, isOwnBotEcho, MUTE_LABEL } from '@/lib/avito/botGate'
import { CRM_ZONES } from '@/lib/crmStages'

// Робот ведёт заявку только в зоне «Квалификация»; дальше курирует человек.
const QUALIFICATION_STAGES = new Set(CRM_ZONES.find(z => z.zone === 'Квалификация')?.stages ?? [])

// Вебхук Avito Messenger: входящее сообщение клиента → лид в crm_leads (по
// avito_chat_id) → AI-менеджер отвечает → снятые данные и скоринг в карточку.
// Путь в whitelist middleware; защита — секрет в query (?key=AVITO_WEBHOOK_SECRET).

// Даём первому вызову время завершить ответ модели, чтобы ретрай Авито успел
// прийти к уже помеченному сообщению и был отсеян дедупом (не двойной ответ).
export const maxDuration = 60

// Правило «отвечает бот или молчит» — одно на систему, в lib/avito/botGate.

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
  // Исходящее в этом чате: либо эхо самого Ивана, либо менеджер написал клиенту
  // сам — из амо, из приложения Авито или из CRM. Разбираем ниже, после дедупа.
  const outgoing = v.author_id != null && v.user_id != null && v.author_id === v.user_id

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

  // ── Исходящее сообщение: менеджер взял карточку — Иван замолкает ──
  //
  // Решение владельца 16.09.2026: «как только с карточкой начал работать менеджер —
  // прям стоп». Ответ менеджера из амо приходит к нам эхом нашего же аккаунта; до
  // сегодня вебхук просто выходил на таком сообщении и не знал, что в чате уже
  // работает человек — бот продолжал отвечать клиенту параллельно с менеджером.
  if (outgoing) {
    const outText = (v.content?.text ?? '').trim()
    const { data: outLeadRows } = await service.from('crm_leads')
      .select('id, bot_muted').eq('avito_chat_id', v.chat_id).order('id').limit(1)
    const outLead = (outLeadRows?.[0] ?? null) as { id: number; bot_muted: boolean | null } | null
    if (!outLead || !outText) return NextResponse.json({ ok: true, echo: true })

    // С чем сравнивать: последние исходящие в ленте. «БОТ: …» — наше эхо,
    // «МЕНЕДЖЕР: …» — менеджер отправил из CRM, там реплика уже записана.
    const { data: outEvs } = await service.from('crm_lead_events')
      .select('text').eq('lead_id', outLead.id).eq('kind', 'message')
      .order('id', { ascending: false }).limit(20)
    const texts = ((outEvs ?? []) as { text: string }[]).map(e => e.text)
    const botTexts = texts.filter(t => t.startsWith('БОТ: ')).map(t => t.slice(5))
    const mgrTexts = texts.filter(t => t.startsWith('МЕНЕДЖЕР: ')).map(t => t.slice(10))
    if (isOwnBotEcho(outText, botTexts)) return NextResponse.json({ ok: true, echo: true })

    const alreadyLogged = isOwnBotEcho(outText, mgrTexts)
    if (!alreadyLogged) {
      await service.from('crm_lead_events').insert({
        lead_id: outLead.id, kind: 'message', author: 'Менеджер',
        text: `МЕНЕДЖЕР: ${outText.slice(0, 4000)}`,
      })
    }
    if (!outLead.bot_muted) {
      await service.from('crm_leads').update({
        bot_muted: true, bot_muted_at: new Date().toISOString(),
        bot_muted_by: 'ответ менеджера в чате', updated_at: new Date().toISOString(),
      }).eq('id', outLead.id)
      await service.from('crm_lead_events').insert({
        lead_id: outLead.id, kind: 'system', author: 'AI',
        text: '🔇 Иван выключен в этом чате: менеджер ответил клиенту сам',
      })
    }
    return NextResponse.json({ ok: true, manager_wrote: true, muted: true })
  }

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
    // Обычный insert, НЕ upsert(onConflict): уникальный индекс на avito_chat_id
    // частичный (WHERE avito_chat_id IS NOT NULL), и Postgres не принимает его в
    // ON CONFLICT (ошибка 42P10). Из-за этого создание лида падало на КАЖДОМ
    // новом чате и Иван молчал с 16.07. Индекс всё равно защищает от гонки: при
    // конкурентной вставке второй insert упадёт по индексу → перечитываем.
    const { data: created } = await service.from('crm_leads')
      .insert({ source: 'avito', avito_chat_id: v.chat_id, manager: 'Иван (AI)' })
      .select('*')
    lead = (created?.[0] ?? null) as Record<string, unknown> | null
    if (lead) {
      await service.from('crm_lead_events').insert({ lead_id: lead.id, kind: 'system', text: 'Лид создан из Авито-чата', author: 'AI' })
    } else {
      // Вставка не удалась (гонка/индекс) — лид уже создан параллельным вызовом, перечитываем.
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

  // Один замок: карточку ведёт менеджер / бот выключен по карточке / заявка вышла
  // из квалификации / сделка закрыта — Иван молчит, сообщение сохранено выше.
  const curStage = (lead.stage as string | null) ?? null
  const gate = botGate(lead as Parameters<typeof botGate>[0], QUALIFICATION_STAGES)
  if (!gate.allowed) {
    await notifyAdmins([
      '💬 <b>Авито: новое сообщение от клиента</b>',
      `Иван молчит: ${MUTE_LABEL[gate.reason]}${gate.who ? ` (${gate.who})` : ''}`,
      `Клиент: ${text.slice(0, 200)}`,
      `Карточка: https://mglass-app.vercel.app/crm/${leadId}`,
    ].join('\n')).catch(() => {})
    return NextResponse.json({ ok: true, silent: gate.reason })
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

  // Few-shot: подбираем похожие ответы живых менеджеров (fail-open → []).
  const [examples, knowledge] = await Promise.all([
    getRelevantExamples(service, { product: known.product, clientText: text }),
    loadBotKnowledge(service),
  ])

  let turn
  try {
    turn = await runAvitoManager(history, known, { examples, knowledge })
  } catch (e) {
    const emsg = e instanceof Error ? e.message : String(e)
    const estatus = (e as { status?: number } | null)?.status
    // Устойчивый сбой AI (кончились кредиты Anthropic / протух ключ / лимит счёта):
    // ретраить бессмысленно — Авито заштормит вебхук, а клиент повиснет без ответа.
    // Так и выгорело 05.08: 311 ошибок за сутки, 22 клиента без единого ответа.
    // При degraded: НЕ снимаем дедуп (Авито не ретраит), даём клиенту вежливый
    // фолбэк и шлём троттлингованный алерт владельцу.
    const degraded = estatus === 401 || estatus === 402 || estatus === 403 ||
      ((estatus === 400 || estatus == null) && /credit|billing|quota|insufficient|balance/i.test(emsg))

    if (degraded) {
      await service.from('crm_lead_events').insert({ lead_id: leadId, kind: 'system', text: `⚠️ AI недоступен: ${emsg.slice(0, 200)}`, author: 'AI' })
      const fallback = 'Здравствуйте! Спасибо за обращение — уже подключаю менеджера, он ответит вам с минуты на минуту.'
      await service.from('crm_lead_events').insert({ lead_id: leadId, kind: 'message', text: `БОТ: ${fallback}`, author: 'AI' })
      if (isAvitoConfigured() && v.user_id != null) {
        try { await avitoSendMessage(v.user_id, v.chat_id, fallback) } catch { /* фолбэк не критичен */ }
      }
      // Троттлинг алерта: не чаще раза в 15 минут (иначе шквал одинаковых сообщений).
      let shouldAlert = true
      try {
        const { data: last } = await service.from('ai_settings').select('value').eq('key', 'ai_error_last_alert').maybeSingle()
        const lastTs = Number((last as { value?: string } | null)?.value ?? 0)
        if (Date.now() - lastTs < 15 * 60 * 1000) shouldAlert = false
        else await service.from('ai_settings').upsert({ key: 'ai_error_last_alert', value: String(Date.now()) }, { onConflict: 'key' })
      } catch { /* нет таблицы/сбой — не глушим алерт */ }
      if (shouldAlert) {
        await notifyAdmins([
          '⚠️ <b>Avito: AI-менеджер недоступен</b>',
          emsg.slice(0, 300),
          'Клиентам уходит вежливый фолбэк, заявки ждут человека. Проверьте баланс Anthropic / ключ.',
          `Карточка: https://mglass-app.vercel.app/crm/${leadId}`,
        ].join('\n')).catch(() => {})
      }
      return NextResponse.json({ ok: true, ai_degraded: true })
    }

    // Транзиентная ошибка (429/5xx/сеть) — снимаем метку дедупа, чтобы ретрай Авито
    // переобработал сообщение (иначе ответ был бы потерян навсегда).
    await service.from('avito_processed_messages').delete().eq('msg_id', msgKey)
    await service.from('crm_lead_events').insert({ lead_id: leadId, kind: 'system', text: `Ошибка AI: ${emsg}`, author: 'AI' })
    return NextResponse.json({ ok: false, ai_error: true }, { status: 500 })
  }

  // Бот упёрся в незнание — вопрос попадает в «Чего бот не знает» на /ai/knowledge.
  if (turn.knowledge_gap) await recordKnowledgeGap(service, { question: turn.knowledge_gap, leadId })

  // Снятые данные — только заполняем пустое/обновляем непустым
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const k of ['name', 'product', 'sizes', 'city', 'budget', 'phone'] as const) {
    const val = turn.extracted[k]
    if (val && val !== lead[k]) patch[k] = val
  }
  if (turn.est_amount != null) patch.est_amount = turn.est_amount
  patch.score = turn.score
  patch.score_reason = turn.score_reason

  // Флажки накапливаются: OR-мёрдж прежних с новыми (флаг, ставший true, не сбрасываем).
  const prevFlags = (lead.flags ?? {}) as LeadFlags
  const mergedFlags: LeadFlags = { ...prevFlags }
  const newlySet: FlagKey[] = []
  for (const [k, v] of Object.entries(turn.flags)) {
    if (v && !prevFlags[k as FlagKey]) { mergedFlags[k as FlagKey] = true; newlySet.push(k as FlagKey) }
  }
  // Диспетчер: детерминированное решение по флагам (робот ведёт зону «Квалификация»).
  const dispatch = decideNextAction(mergedFlags)
  const sc = dispatch.score
  patch.flags = mergedFlags
  patch.readiness = sc.readiness
  patch.heat = sc.heat
  patch.missing_next = sc.missingNext

  const wasHot = (lead.heat as string | null) === 'hot'
  const becameHot = sc.isHot && !wasHot
  const becameQualified = (turn.qualified || sc.isHot) && !lead.qualified
  if (turn.qualified || sc.isHot) patch.qualified = true

  const measureClosed = dispatch.action === 'close_measure'
  if (measureClosed) {
    patch.stage = dispatch.stage          // → «Замер назначен» (выходит из зоны робота)
    patch.qualified = true
  } else if (dispatch.action === 'disqualify') {
    patch.status = 'lost'
    if (!lead.lost_reason) patch.lost_reason = dispatch.reason
  } else if (dispatch.action === 'park' && dispatch.stage && curStage !== dispatch.stage) {
    patch.stage = dispatch.stage          // → «Долгострой» (задача-себе — Фаза B)
  }
  await service.from('crm_leads').update(patch).eq('id', leadId)

  // Каждый новый флаг — событие в ленту (прозрачная история + материал для обучения).
  if (newlySet.length) {
    await service.from('crm_lead_events').insert(
      newlySet.map(k => ({ lead_id: leadId, kind: 'system', text: `✅ Флаг: ${FLAG_BY_KEY[k].label}`, author: 'AI' })),
    )
  }

  if (measureClosed) {
    // Терминал робота: заявка закрыта на замер → задача менеджеру оформить выезд.
    await service.from('crm_lead_events').insert({
      lead_id: leadId, kind: 'system', author: 'AI',
      text: `🎯 Закрыт на замер (согласие + телефон + адрес + готовность) — оформить выезд замерщика`,
    })
    try {
      await service.from('crm_tasks').insert({
        lead_id: leadId, kind: 'measure',
        title: 'Оформить заявку на замер (подтвердить время из графика замерщиков)',
        due_at: new Date().toISOString(),
      })
    } catch { /* не блокируем ответ клиенту */ }
  } else if (becameHot) {
    await service.from('crm_lead_events').insert({
      lead_id: leadId, kind: 'system', author: 'AI',
      text: `🔥 Заявка готова менеджеру (${sc.reason}), готовность ${sc.readiness}%`,
    })
    try {
      await service.from('crm_tasks').insert({
        lead_id: leadId, kind: 'call', title: `Перезвонить — заявка готова (${sc.reason})`,
        due_at: new Date().toISOString(),
      })
    } catch { /* не блокируем ответ клиенту */ }
  } else if (dispatch.action === 'park') {
    // Задача-себе: бот вернётся к отложенному клиенту в назначенный день (Фаза B).
    const days = turn.followUp.inDays ?? 3
    const due = new Date(Date.now() + days * 86_400_000).toISOString()
    const note = turn.followUp.note
    try {
      await service.from('crm_tasks').delete()
        .eq('lead_id', leadId).eq('kind', 'followup').eq('done', false).eq('assignee', 'Иван (AI)')
      await service.from('crm_tasks').insert({
        lead_id: leadId, kind: 'followup', assignee: 'Иван (AI)',
        title: note ? `Вернуться: ${note}` : 'Вернуться к отложенному клиенту', due_at: due,
      })
      await service.from('crm_lead_events').insert({
        lead_id: leadId, kind: 'system', author: 'AI',
        text: `⏸ Отложен${note ? ` (${note})` : ''} — напомню о себе через ${days} дн. (${due.slice(0, 10)})`,
      })
    } catch { /* не блокируем ответ клиенту */ }
  }

  // Перепроверка перед самой отправкой: менеджер мог взять карточку или ответить
  // клиенту, пока модель думала (до минуты). Тем же замком, что и до модели.
  const { data: cur } = await service.from('crm_leads')
    .select('manager, bot_muted, bot_muted_by, stage, status').eq('id', leadId).maybeSingle()
  const curGate = botGate((cur ?? {}) as Parameters<typeof botGate>[0], QUALIFICATION_STAGES)
  if (!curGate.allowed) {
    await service.from('crm_lead_events').insert({
      lead_id: leadId, kind: 'system', author: 'AI',
      text: `Автоответ Ивана отменён — ${MUTE_LABEL[curGate.reason]}${curGate.who ? `: ${curGate.who}` : ''}`,
    })
    return NextResponse.json({ ok: true, taken_over: curGate.reason })
  }

  // Ответ клиенту
  await service.from('crm_lead_events').insert({ lead_id: leadId, kind: 'message', text: `БОТ: ${turn.reply}`, author: 'AI' })
  if (isAvitoConfigured() && v.user_id != null) {
    try { await avitoSendMessage(v.user_id, v.chat_id, turn.reply) }
    catch (e) {
      await service.from('crm_lead_events').insert({ lead_id: leadId, kind: 'system', text: `Не отправлено в Авито: ${e instanceof Error ? e.message : e}`, author: 'AI' })
    }
  } else {
    // Раньше это молчаливо ничего не отправляло: ответ бота зафиксирован «БОТ:»,
    // но в Авито не ушёл (нет user_id в payload или Авито не сконфигурирован) —
    // клиент без ответа, никто не видит. Оставляем видимую системную пометку.
    await service.from('crm_lead_events').insert({
      lead_id: leadId, kind: 'system', author: 'AI',
      text: !isAvitoConfigured()
        ? '⚠️ Ответ не отправлен: интеграция Avito не настроена (нет ключей) — нужен человек'
        : '⚠️ Ответ не отправлен: в вебхуке нет user_id канала — нужен человек',
    })
  }

  // Закрыт на замер / горячий лид / нужен человек → Telegram
  if (measureClosed || becameHot || becameQualified || turn.needs_human) {
    const title = measureClosed ? '🎯 <b>Авито: ЗАКРЫТ НА ЗАМЕР — оформить выезд замерщика</b>'
      : becameHot ? '🔥 <b>Авито: заявка готова менеджеру</b>'
      : becameQualified ? '⭐ <b>Горячий лид с Авито</b>'
      : '✋ <b>Авито: нужен человек</b>'
    const setFlags = Object.keys(mergedFlags)
      .filter(k => mergedFlags[k as FlagKey] && FLAG_BY_KEY[k as FlagKey]?.group !== 'disqualify')
      .map(k => FLAG_BY_KEY[k as FlagKey].label)
    const lines = [
      title,
      [turn.extracted.name ?? lead.name, turn.extracted.phone ?? lead.phone].filter(Boolean).join(' · '),
      [turn.extracted.product ?? lead.product, turn.extracted.sizes ?? lead.sizes].filter(Boolean).join(' · '),
      turn.est_amount != null ? `Предв. цена: ${Math.round(turn.est_amount).toLocaleString('ru-RU')} ₽` : '',
      `Готовность: ${sc.readiness}% · ядро ${sc.coreDone}/${sc.coreTotal}`,
      setFlags.length ? `Флаги: ${setFlags.join(', ')}` : '',
      `Скоринг бота: ${turn.score}/100 — ${turn.score_reason}`,
      '',
      `Карточка: https://mglass-app.vercel.app/crm/${leadId}`,
    ].filter(Boolean)
    await notifyAdmins(lines.join('\n')).catch(() => {})
  }

  return NextResponse.json({ ok: true })
}
