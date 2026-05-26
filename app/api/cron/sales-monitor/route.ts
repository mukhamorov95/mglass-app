import { NextResponse } from 'next/server'
import { collectAllMetrics, buildReport } from '@/lib/salesMonitor'
import { notifyAdmins } from '@/lib/telegram'

export const runtime     = 'nodejs'
export const maxDuration = 60

export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!process.env.AMO_SUBDOMAIN || !process.env.AMO_ACCESS_TOKEN) {
    return NextResponse.json({ error: 'AmoCRM env vars not configured' }, { status: 500 })
  }

  try {
    const metrics = await collectAllMetrics()

    if (metrics.length === 0) {
      await notifyAdmins('⚠️ Sales monitor: менеджеры не найдены. Проверьте AMOCRM_MANAGERS_IDS.')
      return NextResponse.json({ ok: true, managers: 0 })
    }

    await notifyAdmins(buildReport(metrics))
    return NextResponse.json({ ok: true, managers: metrics.length })
  } catch (err) {
    const msg = String(err)
    await notifyAdmins(`❌ Sales monitor ошибка: ${msg}`).catch(() => {})
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
