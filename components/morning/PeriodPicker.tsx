import Link from 'next/link'
import { addDays, monthName, prevMonth, type View } from '@/lib/morning'

// Меню периода на «Команде» и на «Утре» менеджера у владельца. Ссылки и обычные
// GET-формы: выбор живёт в адресе, его можно обновить и переслать.

const BOOK_START = '2024-07'   // с этого месяца есть «Аналитика дохода»

export default function PeriodPicker({ today, view, person }: { today: string; view: View; person?: number }) {
  const month = today.slice(0, 7)
  const year = today.slice(0, 4)
  const week = addDays(today, -6)
  const href = (p: Record<string, string>) => {
    const q = new URLSearchParams(person ? { m: String(person), ...p } : p).toString()
    return q ? `/?${q}` : '/'
  }
  const is = {
    auto: view.kind === 'auto',
    today: view.kind === 'day' && view.day === today,
    week: view.kind === 'range' && view.from === week && view.to === today,
    month: (m: string) => view.kind === 'range' && view.month === m,
    year: (y: string) => view.kind === 'range' && view.from === `${y}-01-01` && view.month == null && view.to.slice(0, 4) === y && (view.to.slice(5) === '12-31' || view.to === today),
  }
  const chips = [
    { label: 'Сегодня', href: href({ d: today }), on: is.today },
    { label: 'Последний рабочий день', href: href({}), on: is.auto },
    ...(person ? [] : [
      { label: '7 дней', href: href({ from: week, to: today }), on: is.week },
      { label: monthName(month), href: href({ month }), on: is.month(month) },
      { label: monthName(prevMonth(month)), href: href({ month: prevMonth(month) }), on: is.month(prevMonth(month)) },
      { label: `${year} год`, href: href({ year }), on: is.year(year) },
      { label: `${Number(year) - 1} год`, href: href({ year: String(Number(year) - 1) }), on: is.year(String(Number(year) - 1)) },
    ]),
  ]
  const months: string[] = []
  for (let m = month; m >= BOOK_START; m = prevMonth(m)) months.push(m)
  const chosenDay = view.kind === 'day' ? view.day : ''
  const chosenMonth = view.kind === 'range' && view.month ? view.month : ''
  const custom = view.kind === 'range' && !view.month && !is.week && !is.year(view.from.slice(0, 4))
  const input = 'border border-[#e4e4e0] rounded-lg px-2 py-1 text-[12px] bg-white'
  const go = 'text-[12px] font-semibold px-2.5 py-1 rounded-lg border border-[#111110] text-[#111110] hover:bg-[#111110] hover:text-white'
  const hidden = person ? <input type="hidden" name="m" value={person} /> : null

  return (
    <div className="bg-white border border-[#e4e4e0] rounded-xl px-3 py-2.5 space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {chips.map(c => (
          <Link key={c.label} href={c.href} aria-current={c.on ? 'page' : undefined}
            className={`text-[12px] px-3 py-1 rounded-full border ${c.on ? 'bg-[#111110] text-white border-[#111110]' : 'border-[#e4e4e0] text-[#3d3d3a] hover:border-[#c4c4be]'}`}>
            {c.label}
          </Link>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-[#6b6b66]">
        <form action="/" method="get" className="flex items-center gap-1.5">
          {hidden}
          <label htmlFor="pp-day">День</label>
          <input id="pp-day" type="date" name="d" required max={today} min="2024-01-01" defaultValue={chosenDay} className={input} />
          <button className={go}>Показать</button>
        </form>
        {!person && (
          <>
            <form action="/" method="get" className="flex items-center gap-1.5">
              <label htmlFor="pp-month">Месяц</label>
              <select id="pp-month" name="month" defaultValue={chosenMonth || month} className={input}>
                {months.map(m => <option key={m} value={m}>{monthName(m)} {m.slice(0, 4)}</option>)}
              </select>
              <button className={go}>Показать</button>
            </form>
            <form action="/" method="get" className="flex items-center gap-1.5">
              <label htmlFor="pp-from">С</label>
              <input id="pp-from" type="date" name="from" required max={today} min="2024-01-01" defaultValue={custom ? view.from : ''} className={input} />
              <label htmlFor="pp-to">по</label>
              <input id="pp-to" type="date" name="to" required max={today} min="2024-01-01" defaultValue={custom ? view.to : ''} className={input} />
              <button className={go}>Показать</button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
