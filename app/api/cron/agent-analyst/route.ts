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
      { data: b2bQuotes },
      { data: b2bOrders },
    ] = await Promise.all([
      supabase.from('calculations').select('id, product_type, final_price, status').gte('created_at', since.toISOString()),
      supabase.from('orders').select('id, total_sale_price, status').gte('created_at', since.toISOString()),
      supabase.from('b2b_quotes').select('id, total_after_discount').gte('created_at', since.toISOString()),
      supabase.from('b2b_orders').select('id, total_amount').gte('created_at', since.toISOString()),
    ])

    const calcCount    = calcs?.length ?? 0
    const calcRevenue  = calcs?.reduce((s, c) => s + (c.final_price ?? 0), 0) ?? 0
    const orderCount   = orders?.length ?? 0
    const orderRevenue = orders?.reduce((s, o) => s + (o.total_sale_price ?? 0), 0) ?? 0
    const b2bCount     = b2bQuotes?.length ?? 0
    const b2bOrdCount  = b2bOrders?.length ?? 0
    const b2bOrdRev    = b2bOrders?.reduce((s, o) => s + (o.total_amount ?? 0), 0) ?? 0
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
- Просчётов B2B: ${b2bCount} · Заказов B2B: ${b2bOrdCount} (выручка: ${b2bOrdRev.toLocaleString('ru-RU')} ₽)
- Итого выручка: ${totalRevenue.toLocaleString('ru-RU')} ₽
- Лучший день в памяти: ${(memory.best_day_revenue ?? 0).toLocaleString('ru-RU')} ₽ (${memory.best_day_date ?? 'нет данных'})
- Расчёты по продуктам:\n${productLines || '  нет данных'}

Цель: 15 млн ₽/мес = ~500 000 ₽/день

Формат — 3 блока:
1. Одна строка: как день относительно цели 500К/день
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

    const msg = [
      `📊 <b>MGlass — Отчёт аналитика</b>`,
      `<i>${now.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}</i>`,
      ``,
      `<b>B2C за 24ч</b>`,
      `Расчётов: ${calcCount} · Заказов: ${orderCount} · Конверсия: ${convRate}%`,
      `Выручка B2C: <b>${orderRevenue.toLocaleString('ru-RU')} ₽</b>`,
      ``,
      `<b>B2B за 24ч</b>`,
      `Просчётов: ${b2bCount} · Заказов: ${b2bOrdCount}`,
      `Выручка B2B: <b>${b2bOrdRev.toLocaleString('ru-RU')} ₽</b>`,
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
