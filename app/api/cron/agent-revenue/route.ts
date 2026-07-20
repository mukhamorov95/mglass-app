import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import * as tg from '@/lib/telegram'
import { readMemory, writeMemory, writeLog, startRun, finishRun, failRun } from '@/lib/agentMemory'

export const runtime = 'nodejs'
export const maxDuration = 60

const PRODUCT_LABELS: Record<string, string> = {
  mirror: 'Зеркало с подсветкой', loft: 'Лофт-перегородка',
  shower: 'Душевая', shower_standard: 'Душевая', shower_budget: 'Душевая',
}

function db() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// Прямая отправка в WhatsApp удалена 20.07 (решение владельца: клиентам пишет
// только Иван). Агент готовит черновик — отправляет менеджер руками.

async function generateMessage(calc: Record<string, unknown>): Promise<string> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
  const product = PRODUCT_LABELS[calc.product_type as string] ?? String(calc.product_type)
  const inputData = (calc.input_data as Record<string, unknown>) ?? {}
  const dims = inputData.width ? `${inputData.width}×${inputData.height} мм` : ''
  const price = ((calc.final_price as number) ?? 0).toLocaleString('ru-RU')
  const name = (calc.client_name as string | null)?.split(' ')[0] ?? ''

  const resp = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001', max_tokens: 150,
    messages: [{ role: 'user', content:
      `Ты — менеджер MGlass. Напиши WhatsApp клиенту (2-3 предложения, без давления).
Продукт: ${product} ${dims}, цена: ${price} ₽, имя: ${name || 'не указано'}.
Расчёт вчера, не ответил. Напомни и спроси есть ли вопросы. Только текст.` }],
  })
  return resp.content.find(b => b.type === 'text')?.text?.trim() ?? ''
}

export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const active = await startRun('revenue')
  if (!active) return NextResponse.json({ ok: true, skipped: true, reason: 'agent disabled' })

  try {
    // Читаем память
    const memory = await readMemory<{
      total_messages_sent: number
      total_orders_from_followup: number
      last_calc_id_processed: number
    }>('revenue')

    const totalSent = memory.total_messages_sent ?? 0

    const supabase = db()

    // Читаем конфиг агента
    const { data: settings } = await supabase
      .from('agent_settings').select('config').eq('agent_key', 'revenue').single()
    const config = (settings?.config ?? {}) as Record<string, unknown>
    const followupHours = (config.followup_hours as number) ?? 18
    const maxPerRun = (config.max_per_run as number) ?? 10

    const now  = new Date()
    const from = new Date(now.getTime() - 30 * 60 * 60 * 1000)
    const to   = new Date(now.getTime() - followupHours * 60 * 60 * 1000)

    const { data: calcs } = await supabase
      .from('calculations')
      .select('id, product_type, final_price, client_name, client_phone, input_data, created_by, created_at')
      .not('client_phone', 'is', null)
      .is('followup_sent_at', null)
      .gte('created_at', from.toISOString())
      .lte('created_at', to.toISOString())
      .limit(maxPerRun)

    if (!calcs?.length) {
      await writeLog('revenue', 'idle', 'Нет расчётов для обработки')
      await finishRun('revenue', '😴 Нет расчётов для followup')
      return NextResponse.json({ ok: true, sent: 0 })
    }

    // Telegram-карта менеджеров
    const managerIds = [...new Set(calcs.map(c => c.created_by).filter(Boolean))]
    const { data: tgUsers } = await supabase.from('telegram_users')
      .select('telegram_id, user_id').in('user_id', managerIds)
    const tgMap: Record<string, number> = {}
    for (const tu of (tgUsers ?? [])) tgMap[tu.user_id] = tu.telegram_id

    let sent = 0
    let skipped = 0

    for (const calc of calcs) {
      try {
        const message = await generateMessage(calc as Record<string, unknown>)
        if (!message) { skipped++; continue }

        // Решение владельца 20.07: клиентам пишет ТОЛЬКО Иван (Авито).
        // Агент готовит черновик и отдаёт менеджеру — отправляет человек.
        await supabase.from('calculations')
          .update({ followup_sent_at: new Date().toISOString() }).eq('id', calc.id)

        const product = PRODUCT_LABELS[calc.product_type] ?? calc.product_type
        const inputData = (calc.input_data as Record<string, unknown>) ?? {}
        const dims = inputData.width ? `${inputData.width}×${inputData.height}` : ''
        const displayName = calc.client_name || calc.client_phone || `#${calc.id}`

        await writeLog('revenue', 'success',
          `Черновик фоллоу-апа для ${displayName} — ${product} ${dims}`,
          { calc_id: calc.id, phone: calc.client_phone })

        const chatId = calc.created_by ? tgMap[calc.created_by] : null
        const tgMsg = [
          `✍️ <b>Черновик фоллоу-апа клиенту</b> (расчёт #${calc.id})`,
          `${product} ${dims} · ${displayName} · ${calc.client_phone}`,
          '',
          'Скопируй и отправь в WhatsApp, если уместно:',
          `<i>${message}</i>`,
        ].join('\n')
        if (chatId) await tg.sendMessage(chatId, tgMsg).catch(() => {})
        else await tg.notifyAdmins(tgMsg).catch(() => {})

        sent++
      } catch (err) {
        await writeLog('revenue', 'error', `Ошибка для расчёта #${calc.id}: ${err}`)
        skipped++
      }
    }

    // Обновляем память
    await writeMemory('revenue', {
      total_messages_sent: totalSent + sent,
      last_run_sent: sent,
      last_run_at: new Date().toISOString(),
    })

    const summary = sent > 0
      ? `✍️ Подготовил ${sent} черновик${sent === 1 ? '' : sent < 5 ? 'а' : 'ов'} менеджерам${skipped > 0 ? `, пропустил ${skipped}` : ''}`
      : `⏭ Пропустил все ${skipped} расчётов`

    if (skipped > 0 && sent === 0) {
      await writeLog('revenue', 'skip', `Пропустил ${skipped} расчётов (нет телефона или ошибка)`)
    }

    await finishRun('revenue', summary)
    return NextResponse.json({ ok: true, sent, skipped })

  } catch (err) {
    await failRun('revenue', String(err))
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}

export const POST = GET
