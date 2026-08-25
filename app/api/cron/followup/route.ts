import { NextResponse } from 'next/server'
import { notifyAdmins } from '@/lib/telegram'
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
  // CRON_FAIL_GUARD: падение крона раньше было тихим 500 — теперь пинг владельцу
  try {
    if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = db()
    const now = new Date()

    // Каденция напоминаний: день-3 и день-7 (окно ±12ч на каждое). Крон запускается
    // ЕЖЕДНЕВНО (было 1-5 = будни → КП определённых дней выпадали из окна и не ловили
    // напоминание вообще). На день-7 — эскалация РОП/владельцу (клиент неделю молчит).
    const STAGES = [
      { days: 3, title: 'КП без ответа 3 дня',  escalate: false },
      { days: 7, title: 'КП без ответа неделю', escalate: true  },
    ]

    let sent = 0, escalated = 0

    for (const stage of STAGES) {
      const from = new Date(now.getTime() - (stage.days + 0.5) * 86_400_000)
      const to   = new Date(now.getTime() - (stage.days - 0.5) * 86_400_000)

      const { data: calcs, error } = await supabase
        .from('calculations')
        .select('id, product_type, final_price, created_by, input_data, created_at')
        .eq('status', 'sent')
        .gte('created_at', from.toISOString())
        .lte('created_at', to.toISOString())
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
      if (!calcs?.length) continue

      const managerIds = [...new Set(calcs.map(c => c.created_by).filter(Boolean))]
      const { data: tgUsers } = await supabase
        .from('telegram_users').select('telegram_id, user_id').in('user_id', managerIds)
      const tgMap: Record<string, number> = {}
      for (const tu of (tgUsers ?? [])) tgMap[tu.user_id] = tu.telegram_id

      for (const calc of calcs) {
        const product = PRODUCT_LABELS[calc.product_type] ?? calc.product_type
        const price   = (calc.final_price as number).toLocaleString('ru-RU')
        const dims    = calc.input_data ? `${calc.input_data.width ?? ''}×${calc.input_data.height ?? ''} мм` : ''
        const chatId  = calc.created_by ? tgMap[calc.created_by] : null

        if (chatId) {
          const msg = [
            `⏰ <b>Напоминание: ${stage.title}</b>`,
            ``,
            `Расчёт #${calc.id} — ${product} ${dims}`,
            `Сумма: <b>${price} ₽</b>`,
            ``,
            stage.days >= 7
              ? `Клиент молчит неделю. Последняя попытка: короткое сообщение или звонок часто возвращает сделку.`
              : `Клиент ещё не ответил. Самое время написать — часто нужен просто толчок.`,
            ``,
            `💬 «Здравствуйте! Подскажите, актуален ли расчёт? Готов ответить на вопросы и подобрать удобный вариант.»`,
          ].join('\n')
          await sendTelegram(chatId, msg)
          sent++
        }

        // Эскалация: неделя тишины → пинг владельцу/РОП (даже если у менеджера нет TG).
        if (stage.escalate) {
          await notifyAdmins([
            `🟠 <b>КП неделю без ответа — нужна помощь РОП</b>`,
            `Расчёт #${calc.id} — ${product} ${dims} · ${price} ₽`,
            chatId ? `Менеджеру напоминание отправлено.` : `⚠️ У менеджера не привязан Telegram.`,
          ].join('\n')).catch(() => {})
          escalated++
        }
      }
    }

    return NextResponse.json({ ok: true, sent, escalated })
  } catch (err) {
    await notifyAdmins(`❌ Крон followup упал: ${err instanceof Error ? err.message : String(err)}`).catch(() => {})
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
