import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import { notifyAdmins } from '@/lib/telegram'
import { readMemory, writeMemory, writeLog, startRun, finishRun, failRun } from '@/lib/agentMemory'

export const runtime = 'nodejs'
export const maxDuration = 60

function db() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// 00:00 текущего дня Europe/Moscow, выраженный в UTC
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

function fmtMoscowHm(iso: string): string {
  return new Date(iso).toLocaleTimeString('ru-RU', {
    timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit',
  })
}

export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const active = await startRun('analyst')
  if (!active) return NextResponse.json({ ok: true, skipped: true, reason: 'agent disabled' })

  try {
    const memory = await readMemory<{
      total_reports_sent: number
      best_day_revenue: number
      best_day_date: string
    }>('analyst')

    const supabase   = db()
    const now        = new Date()
    const todayStart = getMoscowTodayStart(now)

    const [
      { data: calcs },
      { data: orders },
      { data: todayB2b,  error: b2bErr },
      { data: activeB2b, error: activeB2bErr },
    ] = await Promise.all([
      supabase.from('calculations').select('id, final_price, status').gte('created_at', todayStart.toISOString()),
      supabase.from('orders').select('id, total_sale_price').gte('created_at', todayStart.toISOString()),
      // B2B-записи, созданные сегодня — для просчётов
      supabase.from('b2b_orders')
        .select('id, created_at, total_after_discount, notes')
        .gte('created_at', todayStart.toISOString())
        .is('archived_at', null),
      // Все активные B2B-заказы — для paid today и остатка к оплате
      supabase.from('b2b_orders')
        .select('id, total_after_discount, notes')
        .is('archived_at', null),
    ])

    if (b2bErr)       console.error('agent-analyst b2b today error:', b2bErr)
    if (activeB2bErr) console.error('agent-analyst b2b active error:', activeB2bErr)

    // ── B2C (фон, сохраняется в логах) ──────────────────────────────────────
    const calcCount    = calcs?.length ?? 0
    const orderCount   = orders?.length ?? 0
    const orderRevenue = orders?.reduce((s, o) => s + (o.total_sale_price ?? 0), 0) ?? 0

    // ── Новые B2B-просчёты сегодня (по created_at) ──────────────────────────
    const b2bQuoteRows = (todayB2b ?? []).filter(o =>
      ['quote', 'sent', 'pending_approval'].includes(parseB2bStatus(o.notes))
    )
    const b2bQuoteCount   = b2bQuoteRows.length
    const b2bQuoteRevenue = b2bQuoteRows.reduce((s, o) => s + Number(o.total_after_discount ?? 0), 0)

    const sortedQuotes = [...b2bQuoteRows].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    )
    const firstQuoteAt = sortedQuotes.length > 0
      ? fmtMoscowHm(sortedQuotes[0].created_at) : '—'
    const lastQuoteAt  = sortedQuotes.length > 1
      ? fmtMoscowHm(sortedQuotes[sortedQuotes.length - 1].created_at)
      : (sortedQuotes.length === 1 ? fmtMoscowHm(sortedQuotes[0].created_at) : '—')

    // ── Оплачено сегодня: только paid (paid_at timestamp есть) ───────────────
    // partial не считаем — у предоплат нет автоматического timestamp
    const todayStartISO = todayStart.toISOString()
    const paidTodayRows = (activeB2b ?? []).filter(o => {
      const n = parseB2bNotes(o.notes)
      if (!['confirmed', 'agreed'].includes(n.status as string)) return false
      if (n.payment_status !== 'paid') return false
      const paidAt = n.paid_at as string | undefined
      return !!paidAt && paidAt >= todayStartISO
    })
    const paidTodayCount   = paidTodayRows.length
    const paidTodayRevenue = paidTodayRows.reduce((s, o) => s + Number(o.total_after_discount ?? 0), 0)

    // ── Осталось к оплате: все активные confirmed/agreed без full payment ─────
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

    const pctGoal = Math.round(paidTodayRevenue / 500_000 * 100)

    // ── AI анализ ─────────────────────────────────────────────────────────────
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
    const dateLabel = now.toLocaleString('ru-RU', {
      timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric',
    })
    const prompt = `Ты — аналитик MGlass. Дай краткий анализ B2B за сегодня (${dateLabel}).

ДАННЫЕ:
- Новые B2B-просчёты сегодня: ${b2bQuoteCount} шт · ${b2bQuoteRevenue.toLocaleString('ru-RU')} ₽
- Оплачено сегодня (paid): ${paidTodayCount} заказов · ${paidTodayRevenue.toLocaleString('ru-RU')} ₽
- Осталось к оплате (все активные): ${unpaidOrderCount} заказов · ${unpaidAmount.toLocaleString('ru-RU')} ₽
- B2C: расчётов ${calcCount}, заказов ${orderCount} (${orderRevenue.toLocaleString('ru-RU')} ₽)
- Лучший день в памяти: ${(memory.best_day_revenue ?? 0).toLocaleString('ru-RU')} ₽ (${memory.best_day_date ?? 'нет данных'})
- Выполнение цели дня: ${pctGoal}% от 500 000 ₽

ВАЖНО — B2B-специфика (строго соблюдать):
Цикл согласования B2B занимает от 2 до 7 дней. Просчёт ≠ мгновенная оплата.
Правила интерпретации:
- Если просчётов > 0 и оплат = 0 → НЕ паниковать. Писать: "B2B-активность есть: N просчётов на Y ₽. Оплат сегодня нет — для B2B это норма. Проверить неоплаченные заказы (N шт · Y ₽)."
- Если просчётов = 0 и оплат = 0 → "Нет новой B2B-активности. Проверить входящие лиды."
- Если оплаты есть → "B2B принёс X ₽ оплатой сегодня. Pipeline: Y ₽ в просчётах."
ЗАПРЕЩЕНО: "воронка сломана", "провал дня", "системный сбой", "срочно" — если есть просчёты.

Формат — 3 блока:
1. Одна строка: факт оплаты относительно цели 500К/день
2. Главное узкое место (1 предложение)
3. Конкретное действие на сегодня (1 предложение)

Без лишних слов. Только факты.`

    let analysis = ''
    try {
      const resp = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001', max_tokens: 300,
        messages: [{ role: 'user', content: prompt }],
      })
      analysis = resp.content.find(b => b.type === 'text')?.text?.trim() ?? ''
    } catch {
      analysis = 'Анализ недоступен'
    }

    const timeLabel = now.toLocaleString('ru-RU', {
      timeZone: 'Europe/Moscow',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
    const msg = [
      `📊 <b>MGlass — B2B сегодня</b>`,
      `<i>${timeLabel}</i>`,
      ``,
      `<b>Новые просчёты:</b>`,
      `${b2bQuoteCount} шт · <b>${b2bQuoteRevenue.toLocaleString('ru-RU')} ₽</b>`,
      `Первый: ${firstQuoteAt} · Последний: ${lastQuoteAt}`,
      ``,
      `<b>Оплачено сегодня:</b>`,
      `${paidTodayCount} заказ(ов) · <b>${paidTodayRevenue.toLocaleString('ru-RU')} ₽</b>`,
      ``,
      `<b>Осталось к оплате:</b>`,
      `${unpaidOrderCount} заказов · ${unpaidAmount.toLocaleString('ru-RU')} ₽`,
      ``,
      `<b>Итого оплачено: ${paidTodayRevenue.toLocaleString('ru-RU')} ₽</b> / цель 500К (${pctGoal}%)`,
      ``,
      `🤖 <i>${analysis}</i>`,
    ].join('\n')

    await notifyAdmins(msg)

    const newBest = paidTodayRevenue > (memory.best_day_revenue ?? 0)
    await writeMemory('analyst', {
      total_reports_sent: (memory.total_reports_sent ?? 0) + 1,
      last_report_at:     now.toISOString(),
      last_revenue:       paidTodayRevenue,
      ...(newBest ? { best_day_revenue: paidTodayRevenue, best_day_date: now.toISOString().slice(0, 10) } : {}),
    })

    await writeLog('analyst', 'success',
      `B2B сегодня — оплачено ${paidTodayRevenue.toLocaleString('ru-RU')} ₽, просчётов ${b2bQuoteCount}`,
      { b2bQuoteCount, b2bQuoteRevenue, paidTodayCount, paidTodayRevenue, unpaidOrderCount, unpaidAmount })

    await finishRun('analyst', `📊 B2B: ${paidTodayRevenue.toLocaleString('ru-RU')} ₽ оплачено · ${b2bQuoteCount} просчётов`)
    return NextResponse.json({ ok: true, metrics: { b2bQuoteCount, paidTodayRevenue, unpaidOrderCount, unpaidAmount } })

  } catch (err) {
    await failRun('analyst', String(err))
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}

export const POST = GET
