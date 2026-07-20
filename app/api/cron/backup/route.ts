import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const maxDuration = 60

const TABLES = [
  'materials', 'services', 'financial_settings',
  'users', 'calculations', 'orders',
]

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
  const date = new Date().toISOString().split('T')[0]
  const results: Record<string, number | string> = {}
  let totalRows = 0
  const errors: string[] = []

  for (const table of TABLES) {
    const limit = table === 'calculations' ? 5000 : 50000
    const { data, error } = await supabase.from(table).select('*').limit(limit)

    if (error) {
      results[table] = `error: ${error.message}`
      errors.push(table)
      continue
    }

    const bytes = new TextEncoder().encode(JSON.stringify(data ?? []))
    const { error: uploadError } = await supabase.storage
      .from('backups')
      .upload(`${date}/${table}.json`, bytes, {
        contentType: 'application/json',
        upsert: true,
      })

    if (uploadError) {
      results[table] = `upload: ${uploadError.message}`
      errors.push(table)
    } else {
      results[table] = data?.length ?? 0
      totalRows += data?.length ?? 0
    }
  }

  // Notify admins in Telegram
  if (process.env.TELEGRAM_BOT_TOKEN) {
    const { data: admins } = await supabase
      .from('telegram_users')
      .select('telegram_id, users!inner(role)')
      .eq('users.role', 'admin')

    const ok = errors.length === 0
    const msg = ok
      ? `✅ <b>Backup MGlass</b> — ${date}\nСохранено: ${totalRows.toLocaleString('ru-RU')} записей`
      : `⚠️ <b>Backup MGlass</b> — ${date}\nОшибки: ${errors.join(', ')}\nЗаписей: ${totalRows.toLocaleString('ru-RU')}`

    for (const a of (admins ?? [])) {
      await sendTelegram((a as { telegram_id: number }).telegram_id, msg)
    }
  }

  return NextResponse.json({ ok: errors.length === 0, date, results, totalRows })
}
