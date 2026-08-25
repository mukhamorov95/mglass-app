import Link from 'next/link'
import { createServiceClient } from '@/lib/supabase-service'

// Воронка живого Avito-бота «Иван» из crm_leads. Раньше аналитики по нему не было:
// /ai-stats смотрит на отключённый старый контур (ai_managed_chats). Доступ гейтит
// app/admin/layout.tsx (owner-роли).

export const dynamic = 'force-dynamic'

type Lead = {
  id: number; stage: string | null; status: string | null; heat: string | null
  qualified: boolean | null; score: number | null; readiness: number | null
  est_amount: number | null; created_at: string
}

// Date вне тела компонента (react-покомпонентная чистота).
function since(days: number): string { return new Date(Date.now() - days * 86_400_000).toISOString() }
function dayKey(iso: string): string { return iso.slice(0, 10) }

function dist(rows: Lead[], key: (l: Lead) => string | null): [string, number][] {
  const m = new Map<string, number>()
  for (const r of rows) { const k = key(r) || '—'; m.set(k, (m.get(k) ?? 0) + 1) }
  return [...m.entries()].sort((a, b) => b[1] - a[1])
}

function Bars({ title, data, total }: { title: string; data: [string, number][]; total: number }) {
  return (
    <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
      <p className="text-[11px] font-semibold text-[#8a8a85] uppercase tracking-wide mb-2">{title}</p>
      <div className="space-y-1.5">
        {data.length === 0 ? <p className="text-[12px] text-[#c4c4be]">нет данных</p> : data.map(([k, n]) => (
          <div key={k} className="flex items-center gap-2">
            <span className="text-[12px] text-[#4b4b47] w-28 shrink-0 truncate">{k}</span>
            <div className="flex-1 h-2 bg-[#f0f0ec] rounded-full overflow-hidden">
              <div className="h-full bg-[#6b8afd]" style={{ width: `${total > 0 ? Math.round((n / total) * 100) : 0}%` }} />
            </div>
            <span className="text-[12px] font-mono text-[#111110] w-10 text-right">{n}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default async function AvitoFunnelPage() {
  const svc = createServiceClient()
  const { data } = await svc.from('crm_leads')
    .select('id, stage, status, heat, qualified, score, readiness, est_amount, created_at')
    .eq('source', 'avito').gte('created_at', since(30))
    .order('created_at', { ascending: false }).limit(5000)
  const leads = (data ?? []) as Lead[]

  const total = leads.length
  const qualified = leads.filter(l => l.qualified).length
  const withScore = leads.filter(l => typeof l.score === 'number')
  const avgScore = withScore.length ? Math.round(withScore.reduce((s, l) => s + (l.score ?? 0), 0) / withScore.length) : 0
  const estSum = leads.filter(l => l.qualified).reduce((s, l) => s + (Number(l.est_amount) || 0), 0)

  // По дням (последние 14) — простой ряд.
  const byDay = new Map<string, number>()
  for (const l of leads) { const k = dayKey(l.created_at); byDay.set(k, (byDay.get(k) ?? 0) + 1) }
  const days: { d: string; n: number }[] = []
  for (let i = 13; i >= 0; i--) { const d = dayKey(since(i)); days.push({ d, n: byDay.get(d) ?? 0 }) }
  const maxDay = Math.max(1, ...days.map(x => x.n))

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
        <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">Воронка Avito — бот «Иван»</h1>
        <p className="text-[12px] text-[#9a9a95] mt-0.5">Живые лиды из crm_leads за 30 дней. Себестоимость/маржа тут не показываются.</p>
      </div>

      <div className="px-5 pt-4 max-w-[900px] space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {kpi('Лидов за 30 дн', String(total), `${Math.round(total / 30 * 10) / 10} в день`)}
          {kpi('Квалифицировано', String(qualified), total > 0 ? `${Math.round(qualified / total * 100)}% конверсия` : '')}
          {kpi('Ср. скоринг бота', `${avgScore}/100`, `оценено ${withScore.length}`)}
          {kpi('Потенциал (квал.)', `${Math.round(estSum).toLocaleString('ru-RU')} ₽`, 'сумма est_amount')}
        </div>

        <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
          <p className="text-[11px] font-semibold text-[#8a8a85] uppercase tracking-wide mb-2">Лиды по дням (14 дней)</p>
          <div className="flex items-end gap-1 h-24">
            {days.map(x => (
              <div key={x.d} className="flex-1 flex flex-col items-center gap-1" title={`${x.d}: ${x.n}`}>
                <div className="w-full bg-[#6b8afd] rounded-t" style={{ height: `${Math.round((x.n / maxDay) * 100)}%`, minHeight: x.n > 0 ? 3 : 0 }} />
                <span className="text-[9px] text-[#9a9a95]">{x.d.slice(8)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Bars title="По этапу (stage)" data={dist(leads, l => l.stage)} total={total} />
          <Bars title="По температуре (heat)" data={dist(leads, l => l.heat)} total={total} />
          <Bars title="По статусу" data={dist(leads, l => l.status)} total={total} />
        </div>

        <Link href="/admin/ai-control-center" className="inline-block text-[12px] text-[#6b6b66] hover:text-[#111110]">← AI Control Center</Link>
      </div>
    </div>
  )
}
