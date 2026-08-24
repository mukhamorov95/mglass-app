import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { notifyAdmins } from '@/lib/telegram'

export const runtime = 'nodejs'
export const maxDuration = 30

export async function GET(req: Request) {
  // CRON_FAIL_GUARD: падение крона раньше было тихим 500 — теперь пинг владельцу
  try {
    if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    // Get SLA settings (use first row with defaults)
    const { data: settings } = await supabase
      .from('financial_settings')
      .select('sla_days_approved, sla_days_in_work')
      .limit(1)
      .single()

    const slaSettings = settings as { sla_days_approved?: number; sla_days_in_work?: number } | null
    const slaApproved = slaSettings?.sla_days_approved ?? 7
    const slaInWork   = slaSettings?.sla_days_in_work   ?? 21

    const now = new Date()
    const approvedCutoff = new Date(now.getTime() - slaApproved * 86_400_000).toISOString()
    const inWorkCutoff   = new Date(now.getTime() - slaInWork   * 86_400_000).toISOString()

    const { data: stuckOrders } = await supabase
      .from('orders')
      .select('id, number, client_name, status, approved_at, launched_at, total_sale_price, manager_id')
      .or(
        `and(status.eq.approved,approved_at.lt.${approvedCutoff}),` +
        `and(status.eq.in_work,launched_at.lt.${inWorkCutoff})`,
      )

    if (!stuckOrders?.length) {
      return NextResponse.json({ ok: true, alerts: 0 })
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://mglass-app.vercel.app'

    const lines = stuckOrders.map(o => {
      const since = o.status === 'approved'
        ? Math.floor((now.getTime() - new Date(o.approved_at).getTime()) / 86_400_000)
        : Math.floor((now.getTime() - new Date(o.launched_at).getTime()) / 86_400_000)
      const statusLabel = o.status === 'approved' ? 'Одобрен' : 'В работе'
      return `• <a href="${appUrl}/orders/${o.id}">${o.number}</a> — ${o.client_name} [${statusLabel} ${since} дн.]`
    })

    const msg = [
      `⏱ <b>SLA-предупреждение: ${stuckOrders.length} заказ(ов) завис(ли)</b>`,
      '',
      ...lines,
      '',
      `Одобренные ждут >  ${slaApproved} дн., в работе > ${slaInWork} дн.`,
    ].join('\n')

    await notifyAdmins(msg)

    // Раньше SLA-алерт уходил ТОЛЬКО админам — ответственный менеджер о зависшем
    // своём заказе не узнавал. Дополнительно шлём персональный пинг менеджеру.
    let managerPings = 0
    const byMgr = new Map<string, typeof stuckOrders>()
    for (const o of stuckOrders) {
      const mid = (o as { manager_id?: string | null }).manager_id
      if (!mid) continue
      byMgr.set(mid, [...(byMgr.get(mid) ?? []), o])
    }
    if (byMgr.size > 0) {
      const { data: tgUsers } = await supabase
        .from('telegram_users').select('telegram_id, user_id').in('user_id', [...byMgr.keys()])
      const tgMap: Record<string, number> = {}
      for (const tu of (tgUsers ?? [])) tgMap[tu.user_id] = tu.telegram_id
      for (const [mid, orders] of byMgr) {
        const chatId = tgMap[mid]
        if (!chatId) continue
        const mLines = orders.map(o => {
          const st = o.status === 'approved' ? 'Одобрен' : 'В работе'
          const since = o.status === 'approved'
            ? Math.floor((now.getTime() - new Date(o.approved_at).getTime()) / 86_400_000)
            : Math.floor((now.getTime() - new Date(o.launched_at).getTime()) / 86_400_000)
          return `• ${appUrl}/orders/${o.id} — ${o.number} · ${o.client_name} [${st} ${since} дн.]`
        })
        const text = [`⏱ <b>Ваш заказ завис по SLA</b>`, '', ...mLines, '', 'Проверьте статус и сдвиньте по воронке.'].join('\n')
        await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
        }).catch(() => {})
        managerPings++
      }
    }

    return NextResponse.json({ ok: true, alerts: stuckOrders.length, managerPings })
  } catch (err) {
    await notifyAdmins(`❌ Крон sla упал: ${err instanceof Error ? err.message : String(err)}`).catch(() => {})
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
