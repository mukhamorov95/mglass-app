import Link from 'next/link'
import type { ReactNode } from 'react'
import MyDay from '@/components/MyDay'
import { calls, dayLabel, dayRange, duration, hm, monthName, plural, ratePct, rub, type MonthMoney, type View } from '@/lib/morning'
import PeriodPicker from '@/components/morning/PeriodPicker'
import TodayRefresh from '@/components/morning/TodayRefresh'
import { payoutSplit, payouts, planProgress } from '@/lib/earnings/cash'
import { currentTierIndex, distanceToNextTier } from '@/lib/earnings/calculateProgressiveCommission'
import type { Morning, MorningPerson } from '@/lib/morningData'

// «Утро» менеджера: вчера, сегодня, месяц. Все цифры собираются сами — менеджер
// ничего не заполняет. Владелец открывает тот же экран из «Команды» (?m=<amo-id>).

function Card({ label, value, sub, note, children }: { label: string; value: string; sub?: ReactNode; note?: ReactNode; children?: ReactNode }) {
  return (
    <div className="bg-white border border-[#e4e4e0] rounded-xl px-4 py-3.5 flex flex-col gap-1">
      <p className="text-[11px] font-semibold text-[#6b6b66] uppercase tracking-wider">{label}</p>
      <p className="text-[20px] font-bold tabular-nums text-[#111110] leading-tight">{value}</p>
      {children}
      {sub && <p className="text-[12px] text-[#3d3d3a] leading-snug">{sub}</p>}
      {note && <p className="text-[11px] text-[#6b6b66] leading-snug mt-auto pt-1.5 border-t border-dashed border-[#e4e4e0]">{note}</p>}
    </div>
  )
}

const dm = (day: string) => `${day.slice(8, 10)}.${day.slice(5, 7)}`

export function YesterdayCards({ p }: { p: MorningPerson }) {
  const r = p.row
  if (!r || (r.actions === 0 && r.messages_own === 0 && (r.pbx_out ?? 0) === 0)) {
    return <p className="text-[13px] text-[#6b6b66] bg-white border border-[#e4e4e0] rounded-xl px-4 py-3">Своих действий в amo и звонков через АТС в этот день нет.</p>
  }
  const c = calls(r)
  const msgs = r.messages_own + r.messages_no_author
  const s = p.schedule
  const norm = s?.work_from && s?.work_to ? `по графику ${s.work_from.slice(0, 5)}–${s.work_to.slice(0, 5)}` : 'графика нет'
  const docs = r.adv_kp == null
    ? 'КП и счета по этапам amo в этот день не собрались'
    : `замеров назначено ${r.adv_measure ?? 0}`
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
      <Card label="Рабочий день" value={`${hm(r.first_at) ?? '—'} → ${hm(r.last_at) ?? '—'}`} sub={norm}
        note="первое и последнее своё действие в amo — это не приход в офис" />
      <Card label="Звонки" value={`${c.out} исх. · ${c.ok} дозвон`}
        sub={`входящих ${c.in}${c.missed ? ` · пропущено ${c.missed}` : ''} · в разговоре ${duration(c.talkSec)}`}
        note={c.source === 'АТС' ? 'по АТС onlinePBX; пропущенные — по amo' : 'по заметкам amo: АТС в этот день не ответила'} />
      <Card label="Сообщения" value={String(msgs)}
        sub={`${r.reply_median_min != null ? `ответ клиенту в среднем через ${Math.round(r.reply_median_min)} мин · ` : ''}без ответа ${r.unanswered}`}
        note={`${r.messages_own} подписаны вами; ${r.messages_no_author} без автора засчитаны вам как ответственному`} />
      <Card label="Сделки" value={`${r.cards_moved} двинуто`}
        sub={`задач закрыто ${r.tasks_completed}${r.leads_received != null ? ` · новых заявок ${r.leads_received}` : ''}`} note="по AmoCRM" />
      <Card label="Документы" value={r.adv_kp == null ? '—' : `КП ${r.adv_kp} · счетов ${r.adv_invoice ?? 0}`}
        sub={`${docs}; в приложении: быстрых расчётов ${r.app_quick}, КП ${r.app_kp}, договоров ${r.app_contracts}`}
        note="КП и счета — вход сделки в этапы amo «КП отправлено» и «Счёт выставлен»" />
    </div>
  )
}

const pct = (x: number) => `${Math.floor(x)} %`
const ddmm = (day: string) => `${day.slice(8, 10)}.${day.slice(5, 7)}`

// План и комиссия месяца — оба от поступлений из «Аналитики дохода» (решения 3 и 5).
function PlanPayCards({ morning, person, ownerView }: { morning: Morning; person: MorningPerson; ownerView: boolean }) {
  const { month, today, bookLastDay, pay } = morning
  const cash = person.month.prepay + person.month.remainder
  const workDays = person.schedule?.work_days?.length ? person.schedule.work_days : [1, 2, 3, 4, 5]
  const pp = planProgress({ plan: person.plan, cash, month, today, bookLastDay, workDays })
  const split = payoutSplit(person.firstHalf, cash, pay.tiers)
  // Ближайшие две выплаты: в начале октября это 15.10 за конец сентября и 27.10.
  const ahead = payouts({
    month, prevTotal: person.prev.prepay + person.prev.remainder, prevFirstHalf: person.prevFirstHalf,
    monthCash: cash, firstHalf: person.firstHalf, tiers: pay.tiers,
  }).filter(x => x.date >= today).slice(0, 2)
  const rate = pay.tiers[currentTierIndex(cash, pay.tiers)]?.ratePercent
  const next = distanceToNextTier(cash, pay.tiers)
  const m = monthName(month).toLowerCase()
  const through = pp.dataThrough ? `книга внесена по ${ddmm(pp.dataThrough)}` : `за ${m} в книге пока нет записей`

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {pp.plan != null ? (
        <Card label={`План · ${m}`} value={`выполнено ${pct(pp.pct ?? 0)}`}
          sub={<>
            {rub(cash)} из {rub(pp.plan)}<br />
            {pp.forecast != null ? `по темпу к концу месяца: ${rub(pp.forecast)}` : 'прогноза по темпу пока нет'}
            {pp.needPerDay != null && <><br />{pp.needPerDay > 0 ? `нужно ${rub(pp.needPerDay)} в рабочий день · осталось ${pp.daysLeft} ${plural(pp.daysLeft, 'день', 'дня', 'дней')}` : 'план закрыт'}</>}
          </>}
          note={`план в поступлениях: предоплаты + остатки; ставит руководитель · ${through}`}>
          <div className="h-1.5 rounded-full bg-[#efefeb] overflow-hidden mt-0.5">
            <div className="h-full bg-[#111110]" style={{ width: `${Math.min(100, pp.pct ?? 0)}%` }} />
          </div>
        </Card>
      ) : (
        <Card label={`План · ${m}`} value="не поставлен"
          sub={ownerView ? <Link href="/" className="text-blue-600 hover:underline">поставить на «Команде»</Link> : 'план на месяц ставит руководитель'}
          note="план считается в поступлениях: предоплаты + остатки из «Аналитики дохода»" />
      )}
      <Card label={`Комиссия · ${m}`} value={rub(split.total)}
        sub={<>
          ставка {ratePct(rate ?? 0)}{next ? ` · до ${ratePct(next.ratePercent)} ещё ${rub(next.remaining)}` : ' — максимальная'}
          {ahead.map(x => <span key={x.date} className="block">{ddmm(x.date)} — {rub(x.amount)} за {dayRange(x.from, x.to)}</span>)}
        </>}
        note={<>от поступлений месяца, ступенчато; оклад {rub(pay.salary)} отдельно · {through} · <Link href={ownerView ? `/my-earnings?m=${person.amoUserId}` : '/my-earnings'} className="text-blue-600 hover:underline">Мои деньги</Link></>} />
    </div>
  )
}

function MonthCards({ m, prev, prevLabel }: { m: MonthMoney; prev: MonthMoney; prevLabel: string }) {
  const money = m.prepay + m.remainder
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <Card label="Продажи" value={rub(m.salesSum)} sub={`${m.salesCount} ${plural(m.salesCount, 'объект', 'объекта', 'объектов')}`}
        note={`сумма заказов из «Продаж M-Glass» · ${prevLabel}: ${prev.salesCount} · ${rub(prev.salesSum)}`} />
      <Card label="Поступило денег" value={rub(money)} sub={`предоплаты ${rub(m.prepay)} + остатки ${rub(m.remainder)} · оплат ${m.payments}`}
        note={`из «Аналитики дохода» · ${prevLabel}: ${rub(prev.prepay + prev.remainder)}`} />
      <Card label="Путь клиентов" value={`${m.talks} → ${m.measureAssigned} → ${m.measureDone} → ${m.payments}`}
        sub="разговоров → замеров назначено → проведено → оплат"
        note={`оплата — любое поступление, поэтому оплат может быть больше замеров · ${prevLabel}: ${prev.talks} → ${prev.measureAssigned} → ${prev.measureDone} → ${prev.payments}`} />
    </div>
  )
}

// view — только у владельца: он выбирает день сверху; менеджер видит последний рабочий.
export default function MorningManager({ morning, person, ownerView, view }: { morning: Morning; person: MorningPerson; ownerView: boolean; view?: View }) {
  const { day, today, month, prev, bookLastDay } = morning
  const label = day ? dayLabel(day, today, view?.kind === 'day') : null
  const yesterday = new Date(Date.parse(`${today}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
  return (
    <div className="space-y-6">
      {ownerView && (
        <Link href={view?.kind === 'day' ? `/?d=${view.day}` : '/'} className="text-[13px] text-blue-600 hover:underline">← Команда</Link>
      )}
      {ownerView && view && <PeriodPicker today={today} view={view} person={person.amoUserId} />}

      <section className="space-y-3">
        <div className="flex items-baseline gap-2 flex-wrap">
          <h2 className="text-[16px] font-bold text-[#111110]">{label?.title ?? 'Вчера'}</h2>
          {label && <span className="text-[13px] text-[#6b6b66]">{label.date}</span>}
          {ownerView && day === today && <TodayRefresh updatedAt={morning.updatedAt} />}
        </div>
        {day
          ? <YesterdayCards p={person} />
          : <p className="text-[13px] text-[#6b6b66] bg-white border border-[#e4e4e0] rounded-xl px-4 py-3">Снимок дня ещё не собран — первый появится утром в 6:30.</p>}
      </section>

      <section className="space-y-3">
        <h2 className="text-[16px] font-bold text-[#111110]">Сегодня</h2>
        <MyDay amoUserId={ownerView ? person.amoUserId : undefined} />
      </section>

      <section className="space-y-3">
        <div className="flex items-baseline gap-2 flex-wrap">
          <h2 className="text-[16px] font-bold text-[#111110]">{monthName(month)}</h2>
          <span className="text-[13px] text-[#6b6b66]">с 1-го числа</span>
        </div>
        <PlanPayCards morning={morning} person={person} ownerView={ownerView} />
        <MonthCards m={person.month} prev={person.prev} prevLabel={monthName(prev).toLowerCase()} />
        {bookLastDay && bookLastDay < yesterday && (
          <p className="text-[12px] text-amber-700">«Аналитика дохода» заполнена по {dm(bookLastDay)} — поступления, разговоры и замеры после этой даты ещё не внесены в книгу.</p>
        )}
      </section>
    </div>
  )
}
