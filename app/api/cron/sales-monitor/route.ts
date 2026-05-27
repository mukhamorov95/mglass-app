import { NextResponse } from 'next/server'
import { collectAllMetrics, buildReport } from '@/lib/salesMonitor'
import { notifyAdmins } from '@/lib/telegram'
import { createClient } from '@supabase/supabase-js'

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

    // Save daily snapshot to Supabase for Commercial section history
    const today = new Date().toISOString().slice(0, 10)
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
    const rows = metrics.map(m => ({
      date:          today,
      amo_user_id:   m.user.id,
      manager_name:  m.user.name,
      new_leads:     m.newLeadsToday,
      calls_made:    m.callsMade,
      messages_sent: m.messagesSent,
      cards_moved:   m.cardsMoved,
      active_leads:  m.activeLeads,
      zone1:         m.zone1,
      zone2:         m.zone2,
      zone3:         m.zone3,
      stale_zone1:   m.staleZone1.length,
      stale_zone2:   m.staleZone2.length,
      stale_zone3:   m.staleZone3.length,
      invoice_stale: m.invoiceStale.length,
    }))
    await supabase.from('sales_monitor_daily').upsert(rows, { onConflict: 'date,amo_user_id' })

    await notifyAdmins(buildReport(metrics))
    return NextResponse.json({ ok: true, managers: metrics.length })
  } catch (err) {
    const msg = String(err)
    await notifyAdmins(`❌ Sales monitor ошибка: ${msg}`).catch(() => {})
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
