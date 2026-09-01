import ProductionTabs from '@/components/ProductionTabs'
import { mskTime, mskDayShort, mskDayKey, mskDayKeyAgo } from '@/lib/time'
import CrewInviteButton from './CrewInviteButton'
import { getUserProfile, isOwnerRole } from '@/lib/getRole'
import { createServiceClient } from '@/lib/supabase-service'
import { stageLabel } from '@/lib/productionStages'

// Журнал активности цеха: кто сколько отметок закрыл сегодня, вчера и за неделю,
// по каким этапам, и лента последних действий. Экран открыт всему цеху сознательно —
// это не контроль сверху, а общая картина смены: видно, что заказ уже кто-то взял.
//
// Данные появились только 26.08 вместе с П1 (до этого исполнитель нигде не хранился),
// поэтому за прошлые периоды часть отметок без имени — их не выдумываем, показываем как есть.
//
// Сверху — СОСТАВ ЦЕХА целиком, а не только те, кто отмечает. Причина: 26.08 выяснилось,
// что из шести заведённых работников четверо почти не входили в приложение, а полировщик
// (645 задач в очереди) не входил ни разу. Человека, которого нет в системе, на экране
// активности не было вовсе — то есть проблема была невидима ровно там, где на неё смотрят.
// Формулировки нейтральные: «не заходил в приложение», а не «не работает». Мы знаем, что
// люди работают, — они просто не в системе.

export const dynamic = 'force-dynamic'

type Row = { stage_key: string; completed_at: string; completed_by_name: string | null; order_id: number; auto_closed: boolean | null }
type Crew = {
  user_id: string; name: string | null; stations: string[] | null
  last_sign_in: string | null; marks_total: number; marks_7d: number; queue_open: number
}

// Каскад — не человек. Когда мастер закрывает свой этап, все предыдущие этапы
// детали закрываются автоматически и БЕЗ исполнителя: их физически никто не
// отмечал, приписать их кому-то — исказить выработку. Но на этом экране такая
// строка выглядела как работник по имени «Без имени», и владелец принял её за
// Адилета: «проверь, это он?». Не он — это закалка и полировка, закрытые
// каскадом от упаковки Никиты.
const CASCADE_ROW = 'Закрыто автоматически'
// Всё время — московское. Экран рендерится на сервере, а он в UTC: getHours()
// показывал цеху 07:43 вместо 10:43, а группировка по iso.slice(0,10) относила
// вечернюю отметку к предыдущему дню.
const dayKey = mskDayKey
const todayKey = (): string => mskDayKey()
const daysAgoKey = (n: number): string => mskDayKeyAgo(n)
function daysAgoISO(n: number): string { return new Date(Date.now() - n * 86_400_000).toISOString() }
const fmtDay = mskDayShort
const timeOf = mskTime

export default async function ShopActivityPage() {
  const svc = createServiceClient()
  const { data } = await svc.from('production_tasks')
    .select('stage_key, completed_at, completed_by_name, order_id, auto_closed')
    .not('completed_at', 'is', null)
    .gte('completed_at', daysAgoISO(7))
    .order('completed_at', { ascending: false })
    .limit(3000)
  const rows = (data ?? []) as Row[]

  // Состав цеха: все с ролью production, включая тех, кто ни разу не входил.
  const { data: crewData } = await svc.rpc('production_crew_status')
  const crew = (crewData ?? []) as Crew[]
  // Наверх — тех, у кого есть очередь, но нет отметок: это и есть неподключённые.
  const crewSorted = [...crew].sort((a, b) => {
    const rank = (c: Crew) => c.marks_total === 0 && c.queue_open > 0 ? 0 : c.marks_total === 0 ? 2 : 1
    return rank(a) - rank(b) || b.marks_7d - a.marks_7d
  })
  const notOnboarded = crew.filter(c => c.last_sign_in == null && c.queue_open > 0).length
  // Кнопку выдачи ссылки видит только владелец. Настоящий гейт — requireOwner
  // на самом роуте; скрытие здесь только чтобы не мозолило глаза цеху.
  const isOwner = isOwnerRole((await getUserProfile())?.role)

  const today = todayKey()
  const yesterday = daysAgoKey(1)

  // Кто сколько закрыл: сегодня / вчера / за неделю + разбивка по этапам за сегодня.
  const byPerson = new Map<string, { today: number; yest: number; week: number; stages: Map<string, number> }>()
  for (const r of rows) {
    const who = r.auto_closed ? CASCADE_ROW : (r.completed_by_name?.trim() || CASCADE_ROW)
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

        {/* Состав цеха — все, а не только отмечающие */}
        {crew.length > 0 && (
          <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
            <p className="text-[11px] font-semibold text-[#8a8a85] uppercase tracking-wide">Состав цеха · {crew.length}</p>
            {notOnboarded > 0 && (
              <p className="text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2">
                {notOnboarded === 1 ? 'Один человек ни разу не заходил в приложение' : `${notOnboarded} человека ни разу не заходили в приложение`},
                а работа на их станциях идёт. Пока они не вошли, их отметок не будет, и очередь на этих станциях
                растёт не потому, что не успевают.
                {isOwner && ' Пароли заводились автоматически — человек своего не знает. Выдайте ссылку: он задаст пароль сам.'}
              </p>
            )}
            <div className="mt-3 space-y-1">
              {crewSorted.map(c => {
                const never   = c.last_sign_in == null
                const silent  = !never && c.marks_total === 0
                const stations = (c.stations ?? []).map(stageLabel).join(', ')
                return (
                  <div key={c.user_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 border-b border-[#f5f5f3] last:border-0 text-[12.5px]">
                    <span className="font-medium text-[#111110] w-24 shrink-0 truncate">{c.name ?? '—'}</span>
                    <span className="text-[#6b6b66] flex-1 truncate">{stations || 'станция не назначена'}</span>
                    {never ? (
                      <span className="text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-0.5 shrink-0">
                        не заходил в приложение
                      </span>
                    ) : silent ? (
                      <span className="text-[11px] text-[#9a9a95] shrink-0">заходил {fmtDay(c.last_sign_in!)} · отметок нет</span>
                    ) : (
                      <span className="text-[11px] text-[#6b6b66] shrink-0 tabular-nums">
                        {c.marks_7d} за неделю · {c.marks_total} всего
                      </span>
                    )}
                    <span className="text-[11px] text-[#9a9a95] w-20 text-right shrink-0 tabular-nums">
                      {c.queue_open > 0 ? `${c.queue_open} в очереди` : ''}
                    </span>
                    {/* Ссылка нужна не только тем, кто НИ РАЗУ не входил. Адилет заходил
                        один раз 10.07 и с тех пор ни одной отметки: для него кнопки не было,
                        хотя именно он и не может войти. Показываем всем, кто в приложении
                        не работает — не заходил вовсе либо заходил, но не отмечает. */}
                    {isOwner && (never || silent) && <CrewInviteButton userId={c.user_id} name={c.name ?? 'сотрудника'} />}
                  </div>
                )
              })}
            </div>
            <p className="text-[10px] text-[#c4c4be] mt-2.5">
              «Не заходил в приложение» — это про учётную запись, а не про человека: работа на станции идёт,
              просто она нигде не отмечается. Как только человек войдёт, строка заполнится сама.
            </p>
          </div>
        )}

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
                    {stageLabel(st)} · <span className="font-mono font-semibold">{n}</span>
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
                  <span className={`w-24 shrink-0 truncate ${r.auto_closed ? 'text-[#9a9a95] italic' : 'text-[#111110] font-medium'}`}>{r.auto_closed ? 'каскад' : (r.completed_by_name?.trim() || 'каскад')}</span>
                  <span className="text-[#6b6b66] flex-1 truncate">{stageLabel(r.stage_key)}</span>
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
