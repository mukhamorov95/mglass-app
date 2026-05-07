import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const maxDuration = 30

const PRODUCT_LABELS: Record<string, string> = {
  mirror: 'Зеркало',
  loft:   'Лофт',
  shower: 'Душевая',
  shower_standard: 'Душевая',
  shower_budget:   'Душевая',
}

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

async function sendTelegram(chatId: number, text: string) {
  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  })
}

export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = db()

  // Расчёты в статусе 'sent', отправленные ровно 3 дня назад (±12 часов)
  const now       = new Date()
  const from      = new Date(now.getTime() - 3.5 * 24 * 60 * 60 * 1000)
  const to        = new Date(now.getTime() - 2.5 * 24 * 60 * 60 * 1000)

  const { data: calcs, error } = await supabase
    .from('calculations')
    .select('id, product_type, final_price, created_by, input_data, created_at')
    .eq('status', 'sent')
    .gte('created_at', from.toISOString())
    .lte('created_at', to.toISOString())

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  if (!calcs || calcs.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, message: 'No follow-ups needed' })
  }

  // Получаем Telegram IDs менеджеров
  const managerIds = [...new Set(calcs.map(c => c.created_by).filter(Boolean))]
  const { data: tgUsers } = await supabase
    .from('telegram_users')
    .select('telegram_id, user_id')
    .in('user_id', managerIds)

  const tgMap: Record<string, number> = {}
  for (const tu of (tgUsers ?? [])) {
    tgMap[tu.user_id] = tu.telegram_id
  }

  let sent = 0

  for (const calc of calcs) {
    const chatId = calc.created_by ? tgMap[calc.created_by] : null
    if (!chatId) continue

    const product  = PRODUCT_LABELS[calc.product_type] ?? calc.product_type
    const price    = (calc.final_price as number).toLocaleString('ru-RU')
    const dims     = calc.input_data
      ? `${calc.input_data.width ?? ''}×${calc.input_data.height ?? ''} мм`
      : ''

    const msg = [
      `⏰ <b>Напоминание: КП без ответа 3 дня</b>`,
      ``,
      `Расчёт #${calc.id} — ${product} ${dims}`,
      `Сумма: <b>${price} ₽</b>`,
      ``,
      `Клиент ещё не ответил. Самое время написать — часто нужен просто толчок.`,
      ``,
      `💬 "Иван, посмотрели наше предложение? Есть вопросы — с удовольствием отвечу"`,
    ].join('\n')

    await sendTelegram(chatId, msg)
    sent++
  }

  return NextResponse.json({ ok: true, sent, total: calcs.length })
}
