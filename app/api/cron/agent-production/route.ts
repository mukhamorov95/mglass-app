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

export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const active = await startRun('production')
  if (!active) return NextResponse.json({ ok: true, skipped: true, reason: 'agent disabled' })

  try {
    const memory = await readMemory<{
      total_reports_sent: number
      known_issues: string[]
    }>('production')

    const supabase = db()
    const now   = new Date()
    const since = new Date(now.getTime() - 24 * 60 * 60 * 1000)

    // Заказы в производстве
    const { data: orders } = await supabase
      .from('orders')
      .select('id, status, total_sale_price, created_at, updated_at')
      .in('status', ['confirmed', 'in_production', 'ready'])
      .order('created_at', { ascending: true })

    // Новые заказы за 24ч
    const { data: newOrders } = await supabase
      .from('orders')
      .select('id, total_sale_price, status')
      .gte('created_at', since.toISOString())

    if (!orders?.length && !newOrders?.length) {
      await writeLog('production', 'idle', 'Нет заказов в работе')
      await finishRun('production', '😴 Нет заказов в производстве')
      return NextResponse.json({ ok: true, sent: 0 })
    }

    const inProduction = orders?.filter(o => o.status === 'in_production') ?? []
    const confirmed    = orders?.filter(o => o.status === 'confirmed') ?? []
    const ready        = orders?.filter(o => o.status === 'ready') ?? []
    const newToday     = newOrders?.length ?? 0
    const newRevenue   = newOrders?.reduce((s, o) => s + (o.total_sale_price ?? 0), 0) ?? 0

    // Просроченные (старше 7 дней в производстве)
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    const overdue = inProduction.filter(o => new Date(o.created_at) < sevenDaysAgo)

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
    const prompt = `Ты — директор производства MGlass (Максим). Монитори производство, выяви проблемы.

ДАННЫЕ:
- В производстве: ${inProduction.length} заказов
- Ожидают запуска: ${confirmed.length} заказов
- Готовы к выдаче: ${ready.length} заказов
- Просрочено (>7 дней): ${overdue.length} заказов
- Новых заказов сегодня: ${newToday} (${newRevenue.toLocaleString('ru-RU')} ₽)
- Предыдущие проблемы: ${memory.known_issues?.slice(-3).join('; ') || 'нет'}

Формат ответа — строго такой:
🔴 КРИТИЧНО: [если есть просрочки или стоп > 24ч, иначе пропусти]
🟡 ВНИМАНИЕ: [bottleneck, риск, нагрузка]
🟢 НОРМАЛЬНО: [что идёт хорошо]
👁 ДЕЙСТВИЕ: [одно конкретное действие прямо сейчас]

Без лишних слов. Факты и числа.`

    let analysis = ''
    try {
      const resp = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001', max_tokens: 250,
        messages: [{ role: 'user', content: prompt }],
      })
      analysis = resp.content.find(b => b.type === 'text')?.text?.trim() ?? ''
    } catch {
      analysis = 'Анализ недоступен'
    }

    const hasCritical = overdue.length > 0 || inProduction.length > 10
    const statusLine = hasCritical
      ? `🔴 ${inProduction.length} в пр-ве, ${overdue.length} просрочено`
      : `🟢 ${inProduction.length} в пр-ве, ${ready.length} готово`

    const msg = [
      `🏭 <b>Максим — Производство</b>`,
      `<i>${now.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}</i>`,
      ``,
      `В производстве: <b>${inProduction.length}</b> · Ожидают: ${confirmed.length} · Готовы: <b>${ready.length}</b>`,
      overdue.length > 0 ? `⚠️ Просрочено: <b>${overdue.length}</b>` : '',
      newToday > 0 ? `Новых сегодня: ${newToday} (${newRevenue.toLocaleString('ru-RU')} ₽)` : '',
      ``,
      analysis,
    ].filter(Boolean).join('\n')

    await tg.notifyAdmins(msg).catch(() => {})

    // Запоминаем проблемы для следующего запуска
    const issues: string[] = []
    if (overdue.length > 0) issues.push(`${overdue.length} просрочено на ${now.toISOString().slice(0, 10)}`)
    if (inProduction.length > 10) issues.push(`Высокая нагрузка: ${inProduction.length} в работе`)

    await writeMemory('production', {
      total_reports_sent: (memory.total_reports_sent ?? 0) + 1,
      last_report_at: now.toISOString(),
      in_production: inProduction.length,
      overdue_count: overdue.length,
      known_issues: [...(memory.known_issues ?? []).slice(-5), ...issues],
    })

    const level = overdue.length > 0 ? 'warn' : 'success'
    await writeLog('production', level,
      `${statusLine} · новых ${newToday}`,
      { inProduction: inProduction.length, overdue: overdue.length, ready: ready.length })

    await finishRun('production', statusLine)
    return NextResponse.json({ ok: true, inProduction: inProduction.length, overdue: overdue.length })

  } catch (err) {
    await failRun('production', String(err))
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}

export const POST = GET
