import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { notifyAdmins } from '@/lib/telegram'
import { formatSyncReport, syncSalesBook } from '@/lib/sales/salesSheetSync'

export const maxDuration = 300

// Каждое утро в 8:00 МСК: книга «Продажи Мгласс» → «Продажи M-Glass» (/sales).
// Книга остаётся рабочим инструментом менеджеров, реестр её догоняет. Отчёт
// владельцу — каждый день: просил сверку каждое утро, молчание читалось бы
// как «не запускалось».

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const dry = new URL(req.url).searchParams.get('dry') === '1'
  const svc = createServiceClient()
  try {
    const report = await syncSalesBook(svc, {
      dry,
      fetchText: async url => {
        const r = await fetch(url, { cache: 'no-store' })
        if (!r.ok) throw new Error(`HTTP ${r.status} — книга должна быть открыта по ссылке`)
        return r.text()
      },
    })
    if (!dry) await notifyAdmins(formatSyncReport(report)).catch(() => {})
    return NextResponse.json({ ok: !report.error, report })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (!dry) await notifyAdmins(`🧾 <b>Сверка «Продажи Мгласс»</b>\n⚠️ Не прошла: ${msg}`).catch(() => {})
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
