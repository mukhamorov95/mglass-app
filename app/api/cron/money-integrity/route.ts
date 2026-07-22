import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { notifyAdmins } from '@/lib/telegram'

export const maxDuration = 120

// Страховочная сетка по деньгам. Ловит два класса «тихих» бед, которые раньше
// доходили до владельца через проверку глазами:
// (1) ВИТРИНА vs СЫРАЯ ТАБЛИЦА — если представление v_crm_sales_margin теряет
//     строки (как было с JOIN вместо LEFT JOIN), его сумма разойдётся с сырой
//     crm_sales. Считаем оба и сравниваем по месяцам.
// (2) BASELINE — закрытый месяц не должен «худеть» относительно замороженного
//     снимка (sales_reconcile_baseline). Просадка = данные удалились/повредились.
// Пишет владельцу в Telegram только когда есть расхождение.

const RUB = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₽'
const TOL = 1 // рубли: округление построчной скидки допускает копейки

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const svc = createServiceClient()
  const monthOf = (r: { ledger_month: string | null; sale_date: string }) => r.ledger_month ?? r.sale_date.slice(0, 7)
  const curMonth = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' }).slice(0, 7)

  // Сырая таблица (истина): не-voided, dept ≠ b2b, помесячно.
  const { data: rawRows } = await svc.from('crm_sales')
    .select('ledger_month, sale_date, amount, department, voided')
  const rawByMonth = new Map<string, number>()
  for (const r of (rawRows ?? []) as { ledger_month: string | null; sale_date: string; amount: number; department: string | null; voided: boolean }[]) {
    if (r.voided || r.department === 'b2b') continue
    const m = monthOf(r)
    rawByMonth.set(m, (rawByMonth.get(m) ?? 0) + Number(r.amount || 0))
  }

  // Витрина (что видит владелец).
  const { data: viewRows } = await svc.from('v_crm_sales_margin')
    .select('ledger_month, sale_date, amount, department')
  const viewByMonth = new Map<string, number>()
  for (const r of (viewRows ?? []) as { ledger_month: string | null; sale_date: string; amount: number; department: string | null }[]) {
    if (r.department === 'b2b') continue
    const m = monthOf(r)
    viewByMonth.set(m, (viewByMonth.get(m) ?? 0) + Number(r.amount || 0))
  }

  // Baseline закрытых месяцев.
  const { data: baseRows } = await svc.from('sales_reconcile_baseline')
    .select('ledger_month, expected_total').eq('department', 'mglass')
  const baseline = new Map<string, number>()
  for (const b of (baseRows ?? []) as { ledger_month: string; expected_total: number }[]) {
    baseline.set(b.ledger_month, Number(b.expected_total))
  }

  const viewDrift: string[] = []
  const monthsAll = new Set([...rawByMonth.keys(), ...viewByMonth.keys()])
  for (const m of monthsAll) {
    const raw = rawByMonth.get(m) ?? 0
    const view = viewByMonth.get(m) ?? 0
    if (Math.abs(raw - view) > TOL) {
      viewDrift.push(`• ${m}: витрина ${RUB(view)} ≠ данные ${RUB(raw)} (Δ ${RUB(view - raw)})`)
    }
  }

  const baseDrift: string[] = []
  for (const [m, expected] of baseline) {
    if (m >= curMonth) continue // текущий месяц ещё растёт
    const raw = rawByMonth.get(m) ?? 0
    if (Math.abs(raw - expected) > TOL) {
      baseDrift.push(`• ${m}: сейчас ${RUB(raw)}, было ${RUB(expected)} (Δ ${RUB(raw - expected)})`)
    }
  }

  const hasIssue = viewDrift.length > 0 || baseDrift.length > 0
  if (hasIssue) {
    const lines = ['🚨 <b>Сверка денег: расхождение</b>']
    if (viewDrift.length) {
      lines.push(`\n<b>Витрина ≠ данные</b> (представление теряет строки):`)
      lines.push(viewDrift.slice(0, 8).join('\n'))
    }
    if (baseDrift.length) {
      lines.push(`\n<b>Закрытый месяц изменился</b> (проверьте, не удалились ли данные):`)
      lines.push(baseDrift.slice(0, 8).join('\n'))
    }
    await notifyAdmins(lines.join('\n')).catch(() => {})
  }

  return NextResponse.json({
    ok: true, hasIssue,
    viewDrift: viewDrift.length, baseDrift: baseDrift.length,
    monthsChecked: monthsAll.size, baselineMonths: baseline.size,
  })
}
