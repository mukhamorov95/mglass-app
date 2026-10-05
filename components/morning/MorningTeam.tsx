import Link from 'next/link'
import { addDays, calls, dayLabel, duration, hm, monthName, nextMonth, periodTitle, plural, prevMonth, rub, signals, type MonthMoney } from '@/lib/morning'
import type { Team } from '@/lib/morningTeam'
import PlanEditor from '@/components/morning/PlanEditor'
import PeriodPicker from '@/components/morning/PeriodPicker'
import TodayRefresh from '@/components/morning/TodayRefresh'

// «Команда» — первый экран владельца: день или период строкой на человека. Слева
// активность в amo (снимки дня), справа деньги из книг. Строка открывает «Утро»
// этого менеджера.

const dm = (day: string) => `${day.slice(8, 10)}.${day.slice(5, 7)}`
const dmy = (day: string) => `${dm(day)}.${day.slice(0, 4)}`
const th = 'px-2 py-2 font-semibold text-right whitespace-nowrap'
const td = 'px-2 py-2.5 text-right tabular-nums whitespace-nowrap'
const muted = 'text-[#9a9a95]'
const cash = (m: MonthMoney) => m.prepay + m.remainder

export default function MorningTeam({ team }: { team: Team }) {
  const { today, view, act, money, people, others, bookLastDay, planMonth } = team
  const day = act.day
  const yesterday = addDays(today, -1)
  const isDay = view.kind !== 'range'
  const live = day === today
  const label = day ? dayLabel(day, today, view.kind === 'day') : null
  const at = live && act.updatedAt ? hm(act.updatedAt) ?? undefined : undefined
  const moneyTitle = periodTitle(money.from, money.to, today)
  const rangeTitle = view.kind === 'range' ? periodTitle(view.from, view.to, today) : ''
  const covered = act.days.length > 0
  const coverFrom = act.days[0]
  const showPlan = money.month != null

  const tot = { out: 0, ok: 0, in: 0, missed: 0, talk: 0, msgs: 0, moved: 0, kp: 0, inv: 0, workdays: 0, idle: 0, salesN: 0, sales: 0, money: 0, plan: 0, planCash: 0 }
  for (const p of people) {
    const a = p.act
    tot.out += a.out; tot.ok += a.ok; tot.in += a.in; tot.missed += a.missed; tot.talk += a.talkSec
    tot.msgs += a.msgs; tot.moved += a.moved; tot.kp += a.kp; tot.inv += a.inv
    tot.workdays += a.workdays; tot.idle += a.idle
    if (p.plan != null) { tot.plan += p.plan; tot.planCash += cash(p.money) }
  }
  for (const m of [...people.map(p => p.money), ...(others ? [others.money] : [])]) {
    tot.salesN += m.salesCount; tot.sales += m.salesSum; tot.money += cash(m)
  }
  const pct = (c: number, plan: number) => `${Math.floor((c / plan) * 100)} %`

  const notes = people.flatMap(p => {
    const lines = isDay && day
      ? signals(p.row, p.schedule, day, at)
      : [
          p.act.idle ? `рабочих дней по графику без своих действий в amo: ${p.act.idle}` : '',
          p.act.late ? `первое действие на 2 часа и позже графика: ${p.act.late} ${plural(p.act.late, 'день', 'дня', 'дней')}` : '',
          p.act.missed ? `пропущенных входящих: ${p.act.missed}` : '',
        ].filter(Boolean)
    return lines.map(t => ({ who: p.name, t }))
  })

  const actHead = isDay
    ? (label ? `${label.title} · ${dm(day!)}${at ? ` · на ${at}` : ''}` : 'День')
    : covered ? `Активность в amo · ${dm(coverFrom)}–${dm(act.days.at(-1)!)}` : 'Активность в amo'
  const subtitle = isDay
    ? `${label ? `${label.title.toLowerCase()} — ${label.date}` : 'снимок дня ещё не собран'} · деньги: ${moneyTitle.toLowerCase()}${money.to === today ? ' по сегодня' : ''}`
    : `${rangeTitle}${view.kind === 'range' && view.to === today ? ' по сегодня' : ''}`

  const cards = [
    {
      l: `Поступило · ${moneyTitle}`, v: rub(tot.money),
      s: [
        showPlan && tot.plan ? `план ${rub(tot.plan)}, выполнено ${pct(tot.planCash, tot.plan)}` : '',
        money.month && money.prevTotal != null ? `${monthName(prevMonth(money.month)).toLowerCase()}: ${rub(money.prevTotal)}` : '',
      ].filter(Boolean).join(' · ') || 'предоплаты + остатки',
    },
    { l: `Продажи · ${moneyTitle}`, v: rub(tot.sales), s: `${tot.salesN} ${plural(tot.salesN, 'объект', 'объекта', 'объектов')}` },
    {
      l: isDay ? 'Звонки за день' : `Звонки · ${rangeTitle}`,
      v: covered ? `${tot.out} исх. · ${tot.ok} дозвон` : '—',
      s: covered ? `входящих ${tot.in} · в разговоре ${duration(tot.talk)}` : 'снимков дня за период нет',
    },
    {
      l: isDay ? 'КП и счета за день' : `КП и счета · ${rangeTitle}`,
      v: covered ? `${tot.kp} · ${tot.inv}` : '—',
      s: covered ? `сообщений ${tot.msgs} · сделок двинуто ${tot.moved}` : 'снимков дня за период нет',
    },
  ]

  const personHref = (id: number) => `/?m=${id}${view.kind === 'day' ? `&d=${view.day}` : ''}`
  const actCols = isDay ? 6 : 7
  const moneyCols = showPlan ? 4 : 3

  return (
    <section className="space-y-3">
      <div className="flex items-baseline gap-2 flex-wrap">
        <h2 className="text-[16px] font-bold text-[#111110]">Команда</h2>
        <span className="text-[13px] text-[#6b6b66]">{subtitle}</span>
        {live && <TodayRefresh updatedAt={act.updatedAt} />}
      </div>

      <PeriodPicker today={today} view={view} />

      {!isDay && act.firstSnapshot && view.kind === 'range' && view.from < act.firstSnapshot && (
        <p className="text-[12px] text-amber-700">
          Активность в amo (звонки, сообщения, сделки) собирается снимками с {dmy(act.firstSnapshot)} — за более ранние дни в этих колонках ничего нет. Деньги — за весь период из книг.
        </p>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {cards.map(x => (
          <div key={x.l} className="bg-white border border-[#e4e4e0] rounded-xl px-4 py-3.5">
            <p className="text-[11px] font-semibold text-[#6b6b66] uppercase tracking-wider">{x.l}</p>
            <p className="text-[20px] font-bold tabular-nums text-[#111110] leading-tight mt-1">{x.v}</p>
            <p className="text-[12px] text-[#3d3d3a] mt-1">{x.s}</p>
          </div>
        ))}
      </div>

      <div className="bg-white border border-[#e4e4e0] rounded-xl overflow-x-auto">
        <table className="w-full min-w-[960px] text-[13px]">
          <thead>
            <tr className="text-[11px] text-[#6b6b66] uppercase tracking-wider">
              <th className="px-3 pt-3 pb-1 text-left font-semibold"></th>
              <th colSpan={actCols} className="px-2 pt-3 pb-1 text-left font-semibold border-l border-[#efefeb]">{actHead}</th>
              <th colSpan={moneyCols} className="px-2 pt-3 pb-1 text-left font-semibold border-l border-[#efefeb]">{moneyTitle}</th>
            </tr>
            <tr className="text-[11px] text-[#6b6b66] border-b border-[#e4e4e0]">
              <th className="px-3 py-2 text-left font-semibold">Менеджер</th>
              {isDay ? (
                <th className="px-2 py-2 text-left font-semibold border-l border-[#efefeb]">День в amo</th>
              ) : (
                <>
                  <th className="px-2 py-2 text-left font-semibold border-l border-[#efefeb]" title="рабочих по графику дней со своими действиями в amo — из всех рабочих по графику">Дней в amo</th>
                  <th className={th} title="среднее время первого своего действия в рабочие дни">Начало, в среднем</th>
                </>
              )}
              <th className={th}>Звонки исх. / дозвон</th>
              <th className={th}>Входящие</th>
              <th className={th}>Сообщения</th>
              <th className={th}>Сделок двинуто</th>
              <th className={th}>КП · счета</th>
              <th className={`${th} border-l border-[#efefeb]`}>Продажи</th>
              <th className={th}>Поступило</th>
              {showPlan && <th className={th}>План · выполнено</th>}
              <th className={`${th} pr-3`}>Разговоры → замеры → оплаты</th>
            </tr>
          </thead>
          <tbody>
            {people.map(p => {
              const a = p.act
              const r = p.row
              const c = r ? calls(r) : null
              const worked = r && (r.actions > 0 || (r.pbx_out ?? 0) > 0)
              const m = p.money
              const extra = a.worked - (a.workdays - a.idle)
              return (
                <tr key={p.amoUserId} className="border-b border-[#efefeb] hover:bg-[#fafaf8]">
                  <td className="px-3 py-2.5 font-semibold whitespace-nowrap">
                    <Link href={personHref(p.amoUserId)} className="hover:text-blue-600">{p.name} ›</Link>
                  </td>
                  {isDay ? (
                    <>
                      <td className="px-2 py-2.5 whitespace-nowrap border-l border-[#efefeb]">
                        {worked ? `${hm(r!.first_at) ?? '—'} – ${hm(r!.last_at) ?? '—'}` : <span className={muted}>нет действий</span>}
                      </td>
                      <td className={td}>{c ? `${c.out} / ${c.ok}` : '—'}</td>
                      <td className={td}>{c ? `${c.in}${c.missed ? ` · пропущ. ${c.missed}` : ''}` : '—'}</td>
                      <td className={td}>{r ? r.messages_own + r.messages_no_author : '—'}</td>
                      <td className={td}>{r ? r.cards_moved : '—'}</td>
                      <td className={td}>{r && r.adv_kp != null ? `${r.adv_kp} · ${r.adv_invoice ?? 0}` : '—'}</td>
                    </>
                  ) : covered ? (
                    <>
                      <td className="px-2 py-2.5 whitespace-nowrap border-l border-[#efefeb] tabular-nums">
                        {a.workdays ? `${a.workdays - a.idle} из ${a.workdays}` : '—'}
                        {extra > 0 && <span className={muted}> · +{extra} вых.</span>}
                      </td>
                      <td className={td}>{a.startAvg ?? '—'}</td>
                      <td className={td}>{a.out} / {a.ok}</td>
                      <td className={td}>{a.in}{a.missed ? ` · пропущ. ${a.missed}` : ''}</td>
                      <td className={td}>{a.msgs}</td>
                      <td className={td}>{a.moved}</td>
                      <td className={td}>{a.kp} · {a.inv}</td>
                    </>
                  ) : (
                    <td colSpan={actCols} className={`px-2 py-2.5 border-l border-[#efefeb] ${muted}`}>снимков нет</td>
                  )}
                  <td className={`${td} border-l border-[#efefeb]`}>{m.salesCount} · {rub(m.salesSum)}</td>
                  <td className={`${td} font-semibold`}>{rub(cash(m))}</td>
                  {showPlan && <td className={td}>{p.plan != null ? `${rub(p.plan)} · ${p.plan ? pct(cash(m), p.plan) : '—'}` : <span className={muted}>нет плана</span>}</td>}
                  <td className={`${td} pr-3`}>{m.talks} → {m.measureAssigned} → {m.measureDone} → {m.payments}</td>
                </tr>
              )
            })}
            {others && (
              <tr className="border-b border-[#efefeb]">
                <td className="px-3 py-2.5 whitespace-nowrap">
                  <span className="font-semibold">Другие в книгах</span>
                  <span className={`block text-[11px] ${muted}`}>{others.names.join(', ')}</span>
                </td>
                <td colSpan={actCols} className={`px-2 py-2.5 border-l border-[#efefeb] ${muted}`}>не в команде продавцов</td>
                <td className={`${td} border-l border-[#efefeb]`}>{others.money.salesCount} · {rub(others.money.salesSum)}</td>
                <td className={`${td} font-semibold`}>{rub(cash(others.money))}</td>
                {showPlan && <td className={td}>—</td>}
                <td className={`${td} pr-3`}>{others.money.talks} → {others.money.measureAssigned} → {others.money.measureDone} → {others.money.payments}</td>
              </tr>
            )}
            <tr className="bg-[#fafaf8] font-bold">
              <td className="px-3 py-2.5">Итого</td>
              {isDay ? (
                <td className="px-2 py-2.5 border-l border-[#efefeb]"></td>
              ) : (
                <>
                  <td className="px-2 py-2.5 border-l border-[#efefeb] tabular-nums">{covered && tot.workdays ? `${tot.workdays - tot.idle} из ${tot.workdays}` : ''}</td>
                  <td className={td}></td>
                </>
              )}
              <td className={td}>{tot.out} / {tot.ok}</td>
              <td className={td}>{tot.in}{tot.missed ? ` · пропущ. ${tot.missed}` : ''}</td>
              <td className={td}>{tot.msgs}</td>
              <td className={td}>{tot.moved}</td>
              <td className={td}>{tot.kp} · {tot.inv}</td>
              <td className={`${td} border-l border-[#efefeb]`}>{tot.salesN} · {rub(tot.sales)}</td>
              <td className={td}>{rub(tot.money)}</td>
              {showPlan && <td className={td}>{tot.plan ? `${rub(tot.plan)} · ${pct(tot.planCash, tot.plan)}` : '—'}</td>}
              <td className={`${td} pr-3`}></td>
            </tr>
          </tbody>
        </table>
      </div>

      <PlanEditor
        months={[planMonth, nextMonth(planMonth)]}
        sellers={people.map(p => ({ amoUserId: p.amoUserId, name: p.name }))}
        plans={{
          [planMonth]: Object.fromEntries(people.map(p => [p.amoUserId, p.planNow])),
          [nextMonth(planMonth)]: Object.fromEntries(people.map(p => [p.amoUserId, p.planNext])),
        }}
      />

      {notes.length > 0 && (
        <div className="bg-white border border-[#e4e4e0] rounded-xl px-4 py-2">
          <p className="text-[11px] font-semibold text-[#6b6b66] uppercase tracking-wider py-2">Что заметить{isDay ? '' : ` · ${rangeTitle}`}</p>
          {notes.map((n, i) => (
            <p key={i} className="text-[13px] text-[#3d3d3a] py-1.5 border-t border-[#efefeb]"><b className="text-[#111110]">{n.who}:</b> {n.t}</p>
          ))}
        </div>
      )}

      <p className="text-[11px] text-[#6b6b66] leading-relaxed">
        {isDay
          ? <>День — снимок из AmoCRM и АТС (прошедший — в 6:30 утра, сегодняшний — по кнопке «обновить»), правило подсчёта то же, что на «Рабочем дне AMO»; «день в amo» — первое и последнее своё действие в CRM, а не приход. </>
          : <>Период — сумма снимков дня из AmoCRM и АТС; незаконченный сегодняшний день в сумму не входит. «Дней в amo» — рабочие по графику дни со своими действиями из всех рабочих по графику; «вых.» — работа в выходной по графику. </>}
        КП и счета — вход сделки в этапы «КП отправлено» и «Счёт выставлен». Продажи — «Продажи M-Glass» по дате продажи; поступления и путь
        клиентов — «Аналитика дохода»: закрытый месяц целиком — итогом месяца, остальное — по дням. «Другие в книгах» — те, кто есть в книгах,
        но не в команде продавцов. План — в поступлениях; итоговый процент считается только по тем, у кого план поставлен.
        {bookLastDay && bookLastDay < (money.to < yesterday ? money.to : yesterday) && <span className="text-amber-700"> Книга заполнена по {dm(bookLastDay)}.</span>}
      </p>
    </section>
  )
}
