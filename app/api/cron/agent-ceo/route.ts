import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import * as tg from '@/lib/telegram'
import { readMemory, writeMemory, writeLog, startRun, finishRun, failRun } from '@/lib/agentMemory'

export const runtime = 'nodejs'
export const maxDuration = 60

function db() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

function getMoscowTodayStart(now = new Date()): Date {
  const moscowOffsetMs = 3 * 60 * 60 * 1000
  const moscowNow = new Date(now.getTime() + moscowOffsetMs)
  return new Date(
    Date.UTC(moscowNow.getUTCFullYear(), moscowNow.getUTCMonth(), moscowNow.getUTCDate())
    - moscowOffsetMs
  )
}

function parseB2bNotes(notes: unknown): Record<string, unknown> {
  if (!notes) return {}
  try {
    const obj = typeof notes === 'string' ? JSON.parse(notes) : notes
    return typeof obj === 'object' && obj !== null ? (obj as Record<string, unknown>) : {}
  } catch { return {} }
}

function parseB2bStatus(notes: unknown): string {
  return (parseB2bNotes(notes).status as string) ?? 'quote'
}

const GOAL_MONTHLY = 15_000_000
const GOAL_DAILY   = Math.round(GOAL_MONTHLY / 30) // 500 000

export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const active = await startRun('ceo')
  if (!active) return NextResponse.json({ ok: true, skipped: true, reason: 'agent disabled' })

  try {
    const memory = await readMemory<{
      total_reports_sent: number
      last_focus: string
      last_bottleneck: string
      weekly_revenue: number
      days_above_goal: number
      pending_questions: string[]
    }>('ceo')

    const supabase  = db()
    const now       = new Date()
    const todayStart = getMoscowTodayStart(now)
    const today     = new Date(now); today.setHours(0, 0, 0, 0)
    const since24h  = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    const since7d   = new Date(now.getTime() - 7  * 24 * 60 * 60 * 1000)
    const isMorning = now.getHours() >= 7 && now.getHours() <= 10

    // ── Метрики за 24ч ──────────────────────────────────────────────────────
    const [
      { data: calcs24 },
      { data: orders24 },
      { data: todayB2b,  error: b2bErrToday },
      { data: activeB2b, error: b2bErrActive },
      { data: inProd },
      { data: agentSettings },
      { data: logsToday },
      { data: calcs7d },
    ] = await Promise.all([
      supabase.from('calculations').select('id, product_type, final_price, client_phone, followup_sent_at').gte('created_at', since24h.toISOString()),
      supabase.from('orders').select('id, total_sale_price, status').gte('created_at', since24h.toISOString()),
      // B2B-записи, созданные сегодня по Москве — для просчётов
      supabase.from('b2b_orders')
        .select('id, total_after_discount, notes')
        .gte('created_at', todayStart.toISOString())
        .is('archived_at', null),
      // Все активные B2B-заказы — для paid today и остатка к оплате
      supabase.from('b2b_orders')
        .select('id, total_after_discount, notes')
        .is('archived_at', null),
      supabase.from('orders').select('id, status, created_at').in('status', ['confirmed', 'in_production']),
      supabase.from('agent_settings').select('agent_key, enabled, is_running, last_action_text, last_run_at, memory, total_runs'),
      supabase.from('agent_logs').select('agent_key, level, message, ran_at').gte('ran_at', today.toISOString()).order('ran_at', { ascending: false }).limit(50),
      supabase.from('calculations').select('final_price, created_at').gte('created_at', since7d.toISOString()),
    ])

    if (b2bErrToday)  console.error('agent-ceo b2b today error:', b2bErrToday)
    if (b2bErrActive) console.error('agent-ceo b2b active error:', b2bErrActive)

    // ── Считаем KPI ──────────────────────────────────────────────────────────
    const calcCount    = calcs24?.length ?? 0
    const orderCount   = orders24?.length ?? 0
    const orderRevenue = orders24?.reduce((s, o) => s + (o.total_sale_price ?? 0), 0) ?? 0

    // B2B просчёты сегодня
    const b2bQuoteRows = (todayB2b ?? []).filter(o =>
      ['quote', 'sent', 'pending_approval'].includes(parseB2bStatus(o.notes))
    )
    const b2bCount          = b2bQuoteRows.length
    const b2bQuoteRevenue24 = b2bQuoteRows.reduce((s, o) => s + Number(o.total_after_discount ?? 0), 0)

    // Оплачено сегодня: только paid с paid_at >= начало дня Москвы
    const todayStartISO = todayStart.toISOString()
    const paidTodayRows = (activeB2b ?? []).filter(o => {
      const n = parseB2bNotes(o.notes)
      if (!['confirmed', 'agreed'].includes(n.status as string)) return false
      if (n.payment_status !== 'paid') return false
      const paidAt = n.paid_at as string | undefined
      return !!paidAt && paidAt >= todayStartISO
    })
    const b2bPaidCount   = paidTodayRows.length
    const b2bPaidRevenue = paidTodayRows.reduce((s, o) => s + Number(o.total_after_discount ?? 0), 0)

    // Осталось к оплате: все активные confirmed/agreed без full payment
    const unpaidRows = (activeB2b ?? []).filter(o => {
      const n = parseB2bNotes(o.notes)
      return ['confirmed', 'agreed'].includes(n.status as string)
        && n.payment_status !== 'paid'
    })
    const unpaidOrderCount = unpaidRows.length
    const unpaidAmount = unpaidRows.reduce((s, o) => {
      const n       = parseB2bNotes(o.notes)
      const total   = Number(o.total_after_discount ?? 0)
      const prepaid = n.payment_status === 'partial' ? Number(n.prepayment_amount ?? 0) : 0
      return s + Math.max(total - prepaid, 0)
    }, 0)

    const totalRevenue = orderRevenue + b2bPaidRevenue
    const convRate     = calcCount > 0 ? (orderCount / calcCount * 100).toFixed(1) : '0'
    const inProdCount  = inProd?.length ?? 0

    const pendingFollowup = calcs24?.filter(c => c.client_phone && !c.followup_sent_at).length ?? 0

    const weekRevenue = calcs7d?.reduce((s, c) => s + (c.final_price ?? 0), 0) ?? 0
    const monthlyPace = Math.round(weekRevenue / 7 * 30)
    const pctOfGoal   = Math.round(totalRevenue / GOAL_DAILY * 100)

    // ── Статус агентов ───────────────────────────────────────────────────────
    const agents: Record<string, { enabled: boolean; last_action: string; runs: number }> = {}
    for (const a of agentSettings ?? []) {
      agents[a.agent_key] = {
        enabled:     a.enabled,
        last_action: a.last_action_text ?? 'не запускался',
        runs:        a.total_runs ?? 0,
      }
    }

    const recentLogs = (logsToday ?? []).slice(0, 10).map(l =>
      `[${l.agent_key}] ${l.level}: ${l.message}`
    ).join('\n')

    // ── AI-анализ ──────────────────────────────────────────────────────────
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

    const analysisPrompt = `Ты — AI CEO MGlass. Проанализируй текущее состояние бизнеса и прими решение.

МЕТРИКИ СЕГОДНЯ (00:00 Москвы → сейчас):
- Расчётов (B2C, 24ч): ${calcCount} | Заказов: ${orderCount} | Конверсия: ${convRate}%
- Выручка B2C: ${orderRevenue.toLocaleString('ru-RU')} ₽
- B2B просчётов сегодня: ${b2bCount} на сумму ${b2bQuoteRevenue24.toLocaleString('ru-RU')} ₽
- B2B оплачено сегодня: ${b2bPaidCount} заказов · ${b2bPaidRevenue.toLocaleString('ru-RU')} ₽
- B2B остаток к оплате (все активные): ${unpaidOrderCount} заказов · ${unpaidAmount.toLocaleString('ru-RU')} ₽
- ИТОГО оплачено (B2C + B2B paid): ${totalRevenue.toLocaleString('ru-RU')} ₽ (цель: ${GOAL_DAILY.toLocaleString('ru-RU')} ₽/день = ${pctOfGoal}%)
- В производстве: ${inProdCount} заказов
- Ждут followup: ${pendingFollowup} клиентов
- Темп к месяцу (7д): ~${monthlyPace.toLocaleString('ru-RU')} ₽/мес (цель: ${GOAL_MONTHLY.toLocaleString('ru-RU')} ₽)

КОМАНДА:
${Object.entries(agents).map(([k, v]) => `- ${k}: ${v.enabled ? '🟢 активен' : '⚪ выкл'} | ${v.last_action}`).join('\n')}

ЛОГИ СЕГОДНЯ:
${recentLogs || 'нет активности'}

ПРЕДЫДУЩИЙ ФОКУС: ${memory.last_focus ?? 'нет'}
ПРЕДЫДУЩИЙ УЗКИЙ ГОРЛЫШКО: ${memory.last_bottleneck ?? 'нет'}

ВАЖНО — B2B-специфика:
Цикл согласования B2B занимает 2–7 дней. Просчёты ≠ мгновенная оплата. Если просчётов > 0 и оплат сегодня = 0 — это НОРМА, не узкое место. Оценивать pipeline по "остаток к оплате". Не называть "воронка сломана" при наличии просчётов.

ЗАДАЧА:
1. Определи ОДНО главное узкое место прямо сейчас (конверсия? followup? B2B-pipeline? производство?)
2. Реши: какому агенту дать задачу и какую именно
3. Если нужно решение владельца — сформулируй ОДИН конкретный вопрос
4. Дай прогноз: при текущем темпе когда достигнем 15М?

Ответь строго в формате JSON:
{
  "bottleneck": "одна фраза — главная проблема",
  "focus_metric": "метрика на которой фокусируемся",
  "agent_task": {"agent": "revenue|analyst|production|catalog|none", "instruction": "что сделать"},
  "owner_question": "вопрос владельцу или null",
  "forecast_months": число месяцев до 15М при текущем темпе,
  "done_today": ["что сделано агентами сегодня"],
  "summary": "2-3 предложения для отчёта"
}`

    let decision: {
      bottleneck: string
      focus_metric: string
      agent_task: { agent: string; instruction: string }
      owner_question: string | null
      forecast_months: number
      done_today: string[]
      summary: string
    } | null = null

    try {
      const resp = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001', max_tokens: 600,
        messages: [{ role: 'user', content: analysisPrompt }],
      })
      const text = resp.content.find(b => b.type === 'text')?.text ?? ''
      const match = text.match(/\{[\s\S]*\}/)
      if (match) decision = JSON.parse(match[0])
    } catch { /* анализ недоступен */ }

    // ── Триггерим агента если нужно ─────────────────────────────────────────
    if (decision?.agent_task?.agent && decision.agent_task.agent !== 'none') {
      const targetAgent = decision.agent_task.agent
      const agentEnabled = agents[targetAgent]?.enabled
      if (agentEnabled) {
        const host    = new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').host
        const isLocal = host.includes('localhost')
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? `${isLocal ? 'http' : 'https'}://${host}`
        fetch(`${baseUrl}/api/cron/agent-${targetAgent}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${process.env.CRON_SECRET ?? ''}` },
        }).catch(() => {})
        await writeLog('ceo', 'info', `Делегировал ${targetAgent}: ${decision.agent_task.instruction}`)
      }
    }

    // ── Telegram отчёт (только утром или если критично) ──────────────────────
    const isCritical = (pctOfGoal < 30) || (inProdCount > 15)

    if (isMorning || isCritical) {
      const paceEmoji = pctOfGoal >= 80 ? '🟢' : pctOfGoal >= 40 ? '🟡' : '🔴'
      const forecastStr = decision?.forecast_months
        ? decision.forecast_months <= 1 ? 'в этом месяце' : `через ~${decision.forecast_months} мес.`
        : 'нет данных'

      const doneList = (decision?.done_today ?? []).length > 0
        ? decision!.done_today.map(d => `  · ${d}`).join('\n')
        : '  · нет активности'

      const msg = [
        `👔 <b>AI CEO — Ежедневный брифинг</b>`,
        `<i>${now.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', dateStyle: 'short', timeStyle: 'short' })}</i>`,
        ``,
        `🎯 <b>Фокус дня:</b> ${decision?.focus_metric ?? 'конверсия расчёт→заказ'}`,
        ``,
        `${paceEmoji} Выручка: <b>${totalRevenue.toLocaleString('ru-RU')} ₽</b> / цель ${GOAL_DAILY.toLocaleString('ru-RU')} ₽ (${pctOfGoal}%)`,
        `📈 Темп к месяцу: <b>~${monthlyPace.toLocaleString('ru-RU')} ₽</b> → 15М ${forecastStr}`,
        ``,
        `✅ <b>Сделано сегодня:</b>`,
        doneList,
        ``,
        `⚡ <b>Узкое место:</b> ${decision?.bottleneck ?? 'анализ недоступен'}`,
        decision?.agent_task?.agent && decision.agent_task.agent !== 'none'
          ? `🤖 Делегировал ${decision.agent_task.agent}: <i>${decision.agent_task.instruction}</i>`
          : '',
        decision?.owner_question
          ? `\n❓ <b>Нужно решение:</b>\n${decision.owner_question}`
          : '',
        ``,
        `📋 <i>${decision?.summary ?? ''}</i>`,
      ].filter(l => l !== '').join('\n')

      await tg.notifyAdmins(msg).catch(() => {})
    }

    // ── Обновляем память ─────────────────────────────────────────────────────
    const daysAbove = totalRevenue >= GOAL_DAILY
      ? (memory.days_above_goal ?? 0) + 1
      : (memory.days_above_goal ?? 0)

    await writeMemory('ceo', {
      total_reports_sent:  (memory.total_reports_sent ?? 0) + 1,
      last_report_at:      now.toISOString(),
      last_focus:          decision?.focus_metric ?? memory.last_focus,
      last_bottleneck:     decision?.bottleneck   ?? memory.last_bottleneck,
      last_revenue:        totalRevenue,
      monthly_pace:        monthlyPace,
      days_above_goal:     daysAbove,
      pending_questions:   decision?.owner_question
        ? [...(memory.pending_questions ?? []).slice(-4), decision.owner_question]
        : (memory.pending_questions ?? []),
    })

    const statusLine = `${pctOfGoal >= 80 ? '🟢' : pctOfGoal >= 40 ? '🟡' : '🔴'} ${totalRevenue.toLocaleString('ru-RU')} ₽ · темп ${monthlyPace.toLocaleString('ru-RU')} ₽/мес`

    await writeLog('ceo', pctOfGoal >= 80 ? 'success' : 'warn',
      `${statusLine} · узкое: ${decision?.bottleneck ?? '—'}`,
      { totalRevenue, pctOfGoal, monthlyPace, bottleneck: decision?.bottleneck })

    await finishRun('ceo', `👔 ${statusLine}`)
    return NextResponse.json({ ok: true, totalRevenue, pctOfGoal, monthlyPace })

  } catch (err) {
    await failRun('ceo', String(err))
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}

export const POST = GET
