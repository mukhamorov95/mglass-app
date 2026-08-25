import Link from 'next/link'
import { createServiceClient } from '@/lib/supabase-service'
import { deadlineOf } from '@/lib/orderFlags'

// А10: сквозная аналитика B2B-потока (капстоун роадмапа). Объём и пропускная
// способность: сколько заказов входит в производство и сколько выходит (отгрузка),
// успевает ли цех за интейком. Доступ гейтит app/admin/layout (owner-роли).

export const dynamic = 'force-dynamic'

type Row = { id: number; launched_at: string; notes: string | null; total_after_discount: number | null; total_sale_inc_vat: number | null }

function daysAgoISO(d: number): string { return new Date(Date.now() - d * 86_400_000).toISOString() }
function weekStartMs(iso: string): number { const d = new Date(iso); const wd = (d.getDay() + 6) % 7; d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - wd); return d.getTime() }
function shippedDate(notes: string | null): string | null {
  try { const n = notes ? JSON.parse(notes) : {}; const s = n?.stages?.shipped; return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}/.test(s) ? s : null } catch { return null }
}
function isShipped(notes: string | null): boolean {
  try { const n = notes ? JSON.parse(notes) : {}; return n?.stages && Object.prototype.hasOwnProperty.call(n.stages, 'shipped') } catch { return false }
}
const fmtRub = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₽'

export default async function B2BFlowPage() {
  const svc = createServiceClient()
  const { data } = await svc.from('b2b_orders')
    .select('id, launched_at, notes, total_after_discount, total_sale_inc_vat')
    .gte('launched_at', daysAgoISO(84)).order('launched_at', { ascending: false }).limit(5000)
  const rows = (data ?? []) as Row[]

  const d30 = new Date(daysAgoISO(30)).getTime()
  const launched30 = rows.filter(r => new Date(r.launched_at).getTime() >= d30).length
  const shipped30 = rows.filter(r => new Date(r.launched_at).getTime() >= d30 && isShipped(r.notes)).length
  const inWork = rows.filter(r => !isShipped(r.notes)).length
  const rev30 = rows.filter(r => new Date(r.launched_at).getTime() >= d30)
    .reduce((s, r) => s + (Number(r.total_after_discount) || Number(r.total_sale_inc_vat) || 0), 0)

  // Средний цикл (launched→shipped) по тем, у кого есть дата отгрузки.
  const cycles: number[] = []
  for (const r of rows) {
    const sd = shippedDate(r.notes)
    if (sd) { const c = Math.round((new Date(sd).getTime() - new Date(r.launched_at).getTime()) / 86_400_000); if (c >= 0 && c < 120) cycles.push(c) }
  }
  const avgCycle = cycles.length ? Math.round(cycles.reduce((a, b) => a + b, 0) / cycles.length) : null

  // A2 «В срок %»: по отгруженным, у кого есть И дата отгрузки, И срок — успели ли к дедлайну.
  // Сравниваем по дате (первые 10 символов): и дата отгрузки, и deadline_date лежат как YYYY-MM-DD.
  let onTime = 0, late = 0, shippedNoDeadline = 0
  for (const r of rows) {
    const sd = shippedDate(r.notes); if (!sd) continue
    const dl = deadlineOf(r.notes)
    if (!dl) { shippedNoDeadline++; continue }
    if (sd.slice(0, 10) <= dl.slice(0, 10)) onTime++; else late++
  }
  const judged = onTime + late
  const onTimePct = judged ? Math.round(onTime / judged * 100) : null
  const onTimeTone = onTimePct == null ? 'text-[#9a9a95]' : onTimePct >= 95 ? 'text-emerald-600' : onTimePct >= 80 ? 'text-amber-600' : 'text-red-600'

  // Недельный поток: запущено vs отгружено (по дате отгрузки, где есть; иначе по launched-неделе флага).
  const weeks: { ms: number; launched: number; shipped: number }[] = []
  for (let i = 11; i >= 0; i--) weeks.push({ ms: weekStartMs(daysAgoISO(i * 7)), launched: 0, shipped: 0 })
  const wIdx = new Map(weeks.map((w, i) => [w.ms, i]))
  for (const r of rows) {
    const li = wIdx.get(weekStartMs(r.launched_at)); if (li != null) weeks[li].launched++
    const sd = shippedDate(r.notes)
    if (sd) { const si = wIdx.get(weekStartMs(sd)); if (si != null) weeks[si].shipped++ }
  }
  const maxW = Math.max(1, ...weeks.map(w => Math.max(w.launched, w.shipped)))

  const kpi = (label: string, value: string, sub?: string) => (
    <div className="bg-white border border-[#e4e4e0] rounded-xl px-4 py-3">
      <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1">{label}</p>
      <p className="text-[22px] font-bold text-[#111110] font-mono leading-none">{value}</p>
      {sub && <p className="text-[11px] text-[#9a9a95] mt-1">{sub}</p>}
    </div>
  )

  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-20">
      <div className="bg-white border-b border-[#e4e4e0] px-5 pt-6 pb-4">
        <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">B2B-поток</h1>
        <p className="text-[12px] text-[#9a9a95] mt-0.5">Заказы в производстве: интейк vs отгрузка, пропускная способность за 12 недель.</p>
      </div>

      <div className="px-5 pt-4 max-w-[920px] space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {kpi('Запущено за 30 дн', String(launched30), fmtRub(rev30))}
          {kpi('Отгружено за 30 дн', String(shipped30), launched30 > 0 ? `${Math.round(shipped30 / launched30 * 100)}% от запуска` : '')}
          {kpi('Сейчас в работе', String(inWork), 'не отгружено')}
          {kpi('Ср. цикл', avgCycle != null ? `${avgCycle} дн` : '—', avgCycle != null ? `по ${cycles.length} с датой отгрузки` : 'нужны даты отгрузки')}
        </div>

        <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
          <div className="flex items-baseline justify-between mb-1">
            <p className="text-[11px] font-semibold text-[#8a8a85] uppercase tracking-wide">Отгрузка в срок</p>
            <p className={`text-[22px] font-bold font-mono leading-none ${onTimeTone}`}>{onTimePct != null ? `${onTimePct}%` : '—'}</p>
          </div>
          <p className="text-[11px] text-[#9a9a95]">
            {judged
              ? `${onTime} в срок · ${late} с опозданием — из ${judged} заказов с датой отгрузки и сроком`
              : 'пока нет заказов, у которых есть и дата отгрузки, и срок'}
            {shippedNoDeadline ? ` · ещё ${shippedNoDeadline} отгружено без срока (в расчёт не берём)` : ''}
          </p>
        </div>

        <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] font-semibold text-[#8a8a85] uppercase tracking-wide">Поток по неделям · <span className="text-blue-600">запущено</span> / <span className="text-emerald-600">отгружено</span></p>
          </div>
          <div className="flex items-end gap-2 h-32">
            {weeks.map(w => (
              <div key={w.ms} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full flex items-end justify-center gap-0.5 h-28">
                  <div className="w-1/2 bg-blue-400 rounded-t" style={{ height: `${Math.round((w.launched / maxW) * 100)}%`, minHeight: w.launched ? 3 : 0 }} title={`запущено ${w.launched}`} />
                  <div className="w-1/2 bg-emerald-400 rounded-t" style={{ height: `${Math.round((w.shipped / maxW) * 100)}%`, minHeight: w.shipped ? 3 : 0 }} title={`отгружено ${w.shipped}`} />
                </div>
                <span className="text-[9px] text-[#9a9a95]">{new Date(w.ms).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}</span>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-[#9a9a95] mt-2">Синяя выше зелёной устойчиво = очередь растёт (цех не успевает за интейком). «В срок %» считается по заказам, где есть и дата отгрузки, и срок — покрытие растёт по мере проставления сроков при запуске.</p>
        </div>

        <div className="flex gap-3 flex-wrap">
          <Link href="/production-app/load" className="text-[12px] px-3 py-2 rounded-lg bg-white border border-[#e4e4e0] text-[#6b6b66] hover:text-[#111110]">→ Загрузка цеха (узкие места)</Link>
          <Link href="/cfo/order-economics" className="text-[12px] px-3 py-2 rounded-lg bg-white border border-[#e4e4e0] text-[#6b6b66] hover:text-[#111110]">→ Экономика заказов</Link>
        </div>
      </div>
    </div>
  )
}
