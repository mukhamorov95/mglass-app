import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import * as tg from '@/lib/telegram'
import { readMemory, writeMemory, writeLog, startRun, finishRun, failRun } from '@/lib/agentMemory'
import { deadlineOf, PROD_SINCE } from '@/lib/orderFlags'
import { readPaged, readIn } from '@/lib/production/paged'
import { isLiveShopOrder } from '@/lib/production/liveOrder'
import { mskDayKey } from '@/lib/time'

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

    // Реальный цех живёт в production_tasks (B2B, строка = деталь×этап).
    // До 20.07 агент фильтровал orders по статусам confirmed/in_production/ready,
    // которых в таблице не существует, — и месяцами рапортовал «нет заказов».
    //
    // Страницами (lib/production/paged.ts): задач 6600+, PostgREST молча отдавал первую
    // тысячу, и агент считал цех по случайной её части. Читаем только нужное: открытые
    // задачи и закрытые сегодня (МСК), а не всю историю.
    const todayStart = new Date(`${mskDayKey(now)}T00:00:00+03:00`)
    const [openRows, doneRows] = await Promise.all([
      readPaged<{ order_id: number; status: string }>((from, to) => supabase.from('production_tasks')
        .select('id, order_id, status').neq('status', 'done').order('id').range(from, to)),
      readPaged<{ id: number }>((from, to) => supabase.from('production_tasks')
        .select('id').eq('status', 'done').gte('completed_at', todayStart.toISOString()).order('id').range(from, to)),
    ])
    const doneToday = doneRows.length

    // Цех — это живые заказы: с начала производственного контура, не в архиве, не уехавшие.
    // Задачи отгруженных и архивных заказов (на 07.10 — 59 из 1380 открытых) и старых,
    // до PROD_SINCE, — не работа цеха, а неснятые хвосты; агент рапортовал их как «стоит».
    const candidateIds = [...new Set(openRows.map(t => t.order_id))]
    const orderRows = await readIn<{ id: number; custom_number: string | null; client_name: string | null; notes: unknown; archived_at: string | null }, number>(
      candidateIds, (part, from, to) => supabase.from('b2b_orders')
        .select('id, custom_number, client_name, notes, archived_at')
        .in('id', part).gte('created_at', PROD_SINCE).order('id').range(from, to))
    const liveOrders = orderRows.filter(o => isLiveShopOrder(o))
    const liveIds = new Set(liveOrders.map(o => o.id))
    const openTasks = openRows.filter(t => liveIds.has(t.order_id))

    const openByOrder = new Map<number, number>()
    let problemCount = 0
    for (const t of openTasks) {
      openByOrder.set(t.order_id, (openByOrder.get(t.order_id) ?? 0) + 1)
      if (t.status === 'problem') problemCount++
    }
    const shopOrderIds = [...openByOrder.keys()]

    // Дедлайны отгрузки — из notes заказа (единый getDeadline-приоритет)
    const todayISO = now.toISOString().slice(0, 10)
    const overdueB2b = liveOrders
      .filter(o => { const d = deadlineOf(o.notes); return d != null && d.slice(0, 10) < todayISO })

    // Розница (orders) — реальные статусы конечного автомата
    const { data: retail } = await supabase
      .from('orders').select('id, status').in('status', ['in_work', 'approved'])
    const retailInWork  = (retail ?? []).filter(o => o.status === 'in_work').length
    const retailWaiting = (retail ?? []).filter(o => o.status === 'approved').length

    // Новые заказы за 24ч
    const { data: newOrders } = await supabase
      .from('orders')
      .select('id, total_sale_price, status')
      .gte('created_at', since.toISOString())
    const newToday   = newOrders?.length ?? 0
    const newRevenue = newOrders?.reduce((s, o) => s + (o.total_sale_price ?? 0), 0) ?? 0

    if (shopOrderIds.length === 0 && !retail?.length && !newToday) {
      await writeLog('production', 'idle', 'Нет заказов в работе')
      await finishRun('production', '😴 Нет заказов в производстве')
      return NextResponse.json({ ok: true, sent: 0 })
    }

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
    const prompt = `Ты — директор производства MGlass (Максим). Монитори производство, выяви проблемы.

ДАННЫЕ (источник — реальные задачи цеха production_tasks):
- Заказов в цехе (есть открытые этапы): ${shopOrderIds.length}
- Открытых этапов всего: ${openTasks.length}
- Этапов с проблемой (андон): ${problemCount}
- Этапов закрыто сегодня: ${doneToday}
- Просрочена отгрузка: ${overdueB2b.length} заказов${overdueB2b.length ? ` (${overdueB2b.slice(0, 5).map(o => o.custom_number?.trim() || `#${o.id}`).join(', ')})` : ''}
- Розница: в работе ${retailInWork}, ожидают запуска ${retailWaiting}
- Новых заказов за 24ч: ${newToday} (${newRevenue.toLocaleString('ru-RU')} ₽)
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

    const hasCritical = overdueB2b.length > 0 || problemCount > 0
    const statusLine = hasCritical
      ? `🔴 ${shopOrderIds.length} в цехе, просрочено ${overdueB2b.length}, андон ${problemCount}`
      : `🟢 ${shopOrderIds.length} в цехе, закрыто сегодня ${doneToday}`

    const msg = [
      `🏭 <b>Максим — Производство</b>`,
      `<i>${now.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}</i>`,
      ``,
      `В цехе: <b>${shopOrderIds.length}</b> заказов · этапов закрыто сегодня: <b>${doneToday}</b>`,
      problemCount > 0 ? `🚨 Проблемных этапов (андон): <b>${problemCount}</b>` : '',
      overdueB2b.length > 0 ? `⚠️ Просрочена отгрузка: <b>${overdueB2b.length}</b> — ${overdueB2b.slice(0, 5).map(o => o.custom_number?.trim() || `#${o.id}`).join(', ')}` : '',
      `Розница: в работе ${retailInWork} · ожидают запуска ${retailWaiting}`,
      newToday > 0 ? `Новых за 24ч: ${newToday} (${newRevenue.toLocaleString('ru-RU')} ₽)` : '',
      ``,
      analysis,
    ].filter(Boolean).join('\n')

    await tg.notifyAdmins(msg).catch(() => {})

    // Запоминаем проблемы для следующего запуска
    const issues: string[] = []
    if (overdueB2b.length > 0) issues.push(`${overdueB2b.length} просрочено на ${now.toISOString().slice(0, 10)}`)
    if (problemCount > 0) issues.push(`Андон: ${problemCount} проблемных этапов`)

    await writeMemory('production', {
      total_reports_sent: (memory.total_reports_sent ?? 0) + 1,
      last_report_at: now.toISOString(),
      in_production: shopOrderIds.length,
      overdue_count: overdueB2b.length,
      known_issues: [...(memory.known_issues ?? []).slice(-5), ...issues],
    })

    const level = hasCritical ? 'warn' : 'success'
    await writeLog('production', level,
      `${statusLine} · новых ${newToday}`,
      { inShop: shopOrderIds.length, overdue: overdueB2b.length, problem: problemCount, doneToday })

    await finishRun('production', statusLine)
    return NextResponse.json({ ok: true, inShop: shopOrderIds.length, overdue: overdueB2b.length, problem: problemCount })

  } catch (err) {
    await failRun('production', String(err))
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}

export const POST = GET
