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

function parseB2bStatus(notes: unknown): string {
  if (!notes) return 'quote'
  try {
    const obj = typeof notes === 'string' ? JSON.parse(notes) : notes
    return (obj as Record<string, unknown>).status as string ?? 'quote'
  } catch { return 'quote' }
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

    const supabase = db()
    const now   = new Date()
    const since = new Date(now.getTime() - 24 * 60 * 60 * 1000)

    const [
      { data: calcs },
      { data: orders },
      { data: allB2b, error: b2bErr },
    ] = await Promise.all([
      supabase.from('calculations').select('id, product_type, final_price, status').gte('created_at', since.toISOString()),
      supabase.from('orders').select('id, total_sale_price, status').gte('created_at', since.toISOString()),
      supabase.from('b2b_orders').select('id, total_after_discount, notes').gte('created_at', since.toISOString()),
    ])

    if (b2bErr) console.error('agent-analyst b2b metrics error:', b2bErr)

    const calcCount    = calcs?.length ?? 0
    const calcRevenue  = calcs?.reduce((s, c) => s + (c.final_price ?? 0), 0) ?? 0
    const orderCount   = orders?.length ?? 0
    const orderRevenue = orders?.reduce((s, o) => s + (o.total_sale_price ?? 0), 0) ?? 0

    const b2bQuoteRows    = (allB2b ?? []).filter(o => ['quote', 'sent', 'pending_approval'].includes(parseB2bStatus(o.notes)))
    const b2bOrderRows    = (allB2b ?? []).filter(o => ['confirmed', 'agreed'].includes(parseB2bStatus(o.notes)))
    const b2bCount        = b2bQuoteRows.length
    const b2bOrdCount     = b2bOrderRows.length
    const b2bQuoteRevenue = b2bQuoteRows.reduce((s, o) => s + Number(o.total_after_discount ?? 0), 0)
    const b2bOrdRev       = b2bOrderRows.reduce((s, o) => s + Number(o.total_after_discount ?? 0), 0)
    const totalRevenue = orderRevenue + b2bOrdRev
    const convRate     = calcCount > 0 ? ((orderCount / calcCount) * 100).toFixed(1) : '0'

    const byProduct: Record<string, number> = {}
    for (const c of calcs ?? []) {
      const k = c.product_type ?? 'unknown'
      byProduct[k] = (byProduct[k] ?? 0) + 1
    }
    const productLines = Object.entries(byProduct)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `  ${k}: ${v}`)
      .join('\n')

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
    const prompt = `Ты — аналитик MGlass. Дай краткий анализ за последние 24 часа.

ДАННЫЕ:
- Расчётов B2C: ${calcCount} (сумма: ${calcRevenue.toLocaleString('ru-RU')} ₽)
- Заказов B2C: ${orderCount} (выручка: ${orderRevenue.toLocaleString('ru-RU')} ₽)
- Конверсия расчёт→заказ: ${convRate}%
- B2B просчётов в работе: ${b2bCount} на сумму ${b2bQuoteRevenue.toLocaleString('ru-RU')} ₽ (статусы: quote/sent/pending_approval)
- B2B заказов подтверждено: ${b2bOrdCount} на выручку ${b2bOrdRev.toLocaleString('ru-RU')} ₽ (статусы: confirmed/agreed)
- Итого выручка: ${totalRevenue.toLocaleString('ru-RU')} ₽
- Лучший день в памяти: ${(memory.best_day_revenue ?? 0).toLocaleString('ru-RU')} ₽ (${memory.best_day_date ?? 'нет данных'})
- Расчёты по продуктам:\n${productLines || '  нет данных'}

Цель: 15 млн ₽/мес = ~500 000 ₽/день

ВАЖНО — B2B-специфика (строго соблюдать):
Цикл согласования B2B занимает от 2 до 7 дней. Просчёт → согласование → заказ — это многодневный процесс.
Правила интерпретации:
- Если B2B-просчётов > 0 и B2B-заказов = 0 → это НЕ проблема. Писать: "B2B-активность есть: N просчётов на Y ₽. Заказов в 24ч нет — для B2B это норма. Проверить: просчёты старше 2–3 дней и статусы согласования."
- Если B2B-просчётов = 0 и B2B-заказов = 0 → писать: "Нет новой B2B-активности за сутки. Проверить входящие лиды и загрузку менеджеров."
- Если B2B-заказов > 0 → писать: "B2B дал выручку Y ₽ по M заказам."
ЗАПРЕЩЕНО использовать: "воронка сломана", "провалены", "системный сбой", "срочно" — если есть B2B-просчёты.

Формат — 3 блока:
1. Одна строка: как день относительно цели 500К/день (только факт выручки заказов, без B2B-просчётов)
2. Главное узкое место (1 предложение, B2B-специфику соблюдать)
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

    const msg = [
      `📊 <b>MGlass — Отчёт аналитика</b>`,
      `<i>${now.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}</i>`,
      ``,
      `<b>B2C за 24ч</b>`,
      `Расчётов: ${calcCount} · Заказов: ${orderCount} · Конверсия: ${convRate}%`,
      `Выручка B2C: <b>${orderRevenue.toLocaleString('ru-RU')} ₽</b>`,
      ``,
      `<b>B2B за 24ч</b>`,
      `Просчётов: ${b2bCount} · Сумма: <b>${b2bQuoteRevenue.toLocaleString('ru-RU')} ₽</b>`,
      `Заказов: ${b2bOrdCount} · Выручка: <b>${b2bOrdRev.toLocaleString('ru-RU')} ₽</b>`,
      ``,
      `<b>Итого: ${totalRevenue.toLocaleString('ru-RU')} ₽</b> / цель 500К`,
      ``,
      `🤖 <i>${analysis}</i>`,
    ].join('\n')

    await notifyAdmins(msg)

    // Обновляем рекорд дня
    const newBest = totalRevenue > (memory.best_day_revenue ?? 0)
    await writeMemory('analyst', {
      total_reports_sent: (memory.total_reports_sent ?? 0) + 1,
      last_report_at: now.toISOString(),
      last_revenue: totalRevenue,
      ...(newBest ? { best_day_revenue: totalRevenue, best_day_date: now.toISOString().slice(0, 10) } : {}),
    })

    await writeLog('analyst', 'success',
      `Отчёт отправлен — выручка ${totalRevenue.toLocaleString('ru-RU')} ₽`,
      { calcCount, orderCount, totalRevenue, convRate })

    await finishRun('analyst', `📊 ${totalRevenue.toLocaleString('ru-RU')} ₽ / конверсия ${convRate}%`)
    return NextResponse.json({ ok: true, metrics: { calcCount, orderCount, totalRevenue, convRate } })

  } catch (err) {
    await failRun('analyst', String(err))
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}

export const POST = GET
