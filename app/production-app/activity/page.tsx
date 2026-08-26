import ProductionTabs from '@/components/ProductionTabs'
import { createServiceClient } from '@/lib/supabase-service'
import { STAGE_LABELS } from '@/lib/productionStages'

// Журнал активности цеха: кто сколько отметок закрыл сегодня, вчера и за неделю,
// по каким этапам, и лента последних действий. Экран открыт всему цеху сознательно —
// это не контроль сверху, а общая картина смены: видно, что заказ уже кто-то взял.
//
// Данные появились только 26.08 вместе с П1 (до этого исполнитель нигде не хранился),
// поэтому за прошлые периоды часть отметок без имени — их не выдумываем, показываем как есть.

export const dynamic = 'force-dynamic'

type Row = { stage_key: string; completed_at: string; completed_by_name: string | null; order_id: number }

const NO_NAME = 'Без имени'
function dayKey(iso: string): string { return iso.slice(0, 10) }
function todayKey(): string { return new Date().toISOString().slice(0, 10) }
function daysAgoKey(n: number): string { return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10) }
function daysAgoISO(n: number): string { return new Date(Date.now() - n * 86_400_000).toISOString() }
function timeOf(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export default async function ShopActivityPage() {
  const svc = createServiceClient()
  const { data } = await svc.from('production_tasks')
    .select('stage_key, completed_at, completed_by_name, order_id')
    .not('completed_at', 'is', null)
    .gte('completed_at', daysAgoISO(7))
    .order('completed_at', { ascending: false })
    .limit(3000)
  const rows = (data ?? []) as Row[]

  const today = todayKey()
  const yesterday = daysAgoKey(1)

  // Кто сколько закрыл: сегодня / вчера / за неделю + разбивка по этапам за сегодня.
  const byPerson = new Map<string, { today: number; yest: number; week: number; stages: Map<string, number> }>()
  for (const r of rows) {
    const who = r.completed_by_name?.trim() || NO_NAME
    let p = byPerson.get(who)
    if (!p) { p = { today: 0, yest: 0, week: 0, stages: new Map() }; byPerson.set(who, p) }
    p.week++
    const d = dayKey(r.completed_at)
    if (d === today) {
      p.today++
      p.stages.set(r.stage_key, (p.stages.get(r.stage_key) ?? 0) + 1)
    } else if (d === yesterday) p.yest++
  }
  const people = [...byPerson.entries()].sort((a, b) => b[1].week - a[1].week)
  const totalToday = people.reduce((s, [, p]) => s + p.today, 0)
  const totalYest = people.reduce((s, [, p]) => s + p.yest, 0)

  // Лента: последние действия, чтобы было видно движение прямо сейчас.
  const feed = rows.slice(0, 40)

  const maxWeek = Math.max(1, ...people.map(([, p]) => p.week))

  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-20">
      <ProductionTabs />

      <div className="bg-white border-b border-[#e4e4e0] px-5 pt-5 pb-4">
        <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">Кто что делал</h1>
        <p className="text-[12px] text-[#9a9a95] mt-0.5">
          Отметки «Готово» за последние 7 дней. Сегодня — {totalToday}, вчера — {totalYest}.
        </p>
      </div>

      <div className="px-4 pt-4 max-w-[860px] space-y-4">

        {people.length === 0 && (
          <div className="bg-white border border-[#e4e4e0] rounded-xl p-5 text-center">
            <p className="text-[14px] text-[#6b6b66]">За неделю отметок нет.</p>
          </div>
        )}

        {people.map(([who, p]) => (
          <div key={who} className="bg-white border border-[#e4e4e0] rounded-xl p-4">
            <div className="flex items-baseline justify-between gap-3 mb-2">
              <p className="text-[15px] font-semibold text-[#111110]">{who}</p>
              <p className="text-[13px] text-[#9a9a95] font-mono tabular-nums">
                сегодня <span className="text-[17px] font-bold text-[#111110]">{p.today}</span>
                <span className="mx-2 text-[#d4d4ce]">·</span>
                вчера {p.yest}
                <span className="mx-2 text-[#d4d4ce]">·</span>
                неделя {p.week}
              </p>
            </div>

            <div className="h-1.5 bg-[#f0f0ec] rounded-full overflow-hidden mb-2">
              <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${Math.round(p.week / maxWeek * 100)}%` }} />
            </div>

            {p.stages.size > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {[...p.stages.entries()].sort((a, b) => b[1] - a[1]).map(([st, n]) => (
                  <span key={st} className="text-[11px] text-[#6b6b66] bg-[#f5f5f3] border border-[#e4e4e0] rounded-md px-2 py-0.5">
                    {STAGE_LABELS[st] ?? st} · <span className="font-mono font-semibold">{n}</span>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-[#9a9a95]">сегодня отметок ещё нет</p>
            )}
          </div>
        ))}

        {feed.length > 0 && (
          <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
            <p className="text-[11px] font-semibold text-[#8a8a85] uppercase tracking-wide mb-3">Последние действия</p>
            <div className="space-y-1.5">
              {feed.map((r, i) => (
                <div key={i} className="flex items-center gap-2.5 text-[12.5px] py-1 border-b border-[#f5f5f3] last:border-0">
                  <span className="font-mono text-[#9a9a95] tabular-nums w-11 shrink-0">{timeOf(r.completed_at)}</span>
                  <span className="text-[#111110] font-medium w-24 shrink-0 truncate">{r.completed_by_name?.trim() || NO_NAME}</span>
                  <span className="text-[#6b6b66] flex-1 truncate">{STAGE_LABELS[r.stage_key] ?? r.stage_key}</span>
                  <span className="font-mono text-[#9a9a95] shrink-0">#{r.order_id}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="text-[11px] text-[#9a9a95] px-1">
          Исполнитель сохраняется с 26.08. У части отметок имени нет — они закрыты раньше или
          путём, который его не записывал; выдумывать его не стали.
        </p>
      </div>
    </div>
  )
}
