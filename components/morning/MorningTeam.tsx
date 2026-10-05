import Link from 'next/link'
import { calls, dayLabel, duration, hm, monthName, rub, signals } from '@/lib/morning'
import type { Morning } from '@/lib/morningData'

// «Команда» — первый экран владельца: тот же день и месяц, что у каждого менеджера
// на его «Утре», строкой на человека. Строка открывает «Утро» этого менеджера.

const dm = (day: string) => `${day.slice(8, 10)}.${day.slice(5, 7)}`
const th = 'px-2 py-2 font-semibold text-right whitespace-nowrap'
const td = 'px-2 py-2.5 text-right tabular-nums whitespace-nowrap'

export default function MorningTeam({ morning }: { morning: Morning }) {
  const { day, today, month, prev, people, bookLastDay } = morning
  const label = day ? dayLabel(day, today) : null
  const yesterday = new Date(Date.parse(`${today}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10)

  const tot = { out: 0, ok: 0, in: 0, missed: 0, talk: 0, msgs: 0, moved: 0, kp: 0, inv: 0, salesN: 0, sales: 0, money: 0, prevMoney: 0 }
  for (const p of people) {
    if (p.row) {
      const c = calls(p.row)
      tot.out += c.out; tot.ok += c.ok; tot.in += c.in; tot.missed += c.missed; tot.talk += c.talkSec
      tot.msgs += p.row.messages_own + p.row.messages_no_author
      tot.moved += p.row.cards_moved; tot.kp += p.row.adv_kp ?? 0; tot.inv += p.row.adv_invoice ?? 0
    }
    tot.salesN += p.month.salesCount; tot.sales += p.month.salesSum
    tot.money += p.month.prepay + p.month.remainder
    tot.prevMoney += p.prev.prepay + p.prev.remainder
  }
  const notes = day ? people.flatMap(p => signals(p.row, p.schedule, day).map(t => ({ who: p.name, t }))) : []

  return (
    <section className="space-y-3">
      <div className="flex items-baseline gap-2 flex-wrap">
        <h2 className="text-[16px] font-bold text-[#111110]">Команда</h2>
        <span className="text-[13px] text-[#6b6b66]">
          {label ? `${label.title.toLowerCase()} — ${label.date}` : 'снимок дня ещё не собран'} · {monthName(month).toLowerCase()} с 1-го числа
        </span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { l: `Поступило · ${monthName(month).toLowerCase()}`, v: rub(tot.money), s: `${monthName(prev).toLowerCase()}: ${rub(tot.prevMoney)}` },
          { l: `Продажи · ${monthName(month).toLowerCase()}`, v: rub(tot.sales), s: `${tot.salesN} объектов` },
          { l: 'Звонки за день', v: `${tot.out} исх. · ${tot.ok} дозвон`, s: `входящих ${tot.in} · в разговоре ${duration(tot.talk)}` },
          { l: 'КП и счета за день', v: `${tot.kp} · ${tot.inv}`, s: `сообщений ${tot.msgs} · сделок двинуто ${tot.moved}` },
        ].map(x => (
          <div key={x.l} className="bg-white border border-[#e4e4e0] rounded-xl px-4 py-3.5">
            <p className="text-[11px] font-semibold text-[#6b6b66] uppercase tracking-wider">{x.l}</p>
            <p className="text-[20px] font-bold tabular-nums text-[#111110] leading-tight mt-1">{x.v}</p>
            <p className="text-[12px] text-[#3d3d3a] mt-1">{x.s}</p>
          </div>
        ))}
      </div>

      <div className="bg-white border border-[#e4e4e0] rounded-xl overflow-x-auto">
        <table className="w-full min-w-[920px] text-[13px]">
          <thead>
            <tr className="text-[11px] text-[#6b6b66] uppercase tracking-wider">
              <th className="px-3 pt-3 pb-1 text-left font-semibold"></th>
              <th colSpan={6} className="px-2 pt-3 pb-1 text-left font-semibold border-l border-[#efefeb]">{label ? `${label.title} · ${dm(day!)}` : 'День'}</th>
              <th colSpan={3} className="px-2 pt-3 pb-1 text-left font-semibold border-l border-[#efefeb]">{monthName(month)}</th>
            </tr>
            <tr className="text-[11px] text-[#6b6b66] border-b border-[#e4e4e0]">
              <th className="px-3 py-2 text-left font-semibold">Менеджер</th>
              <th className="px-2 py-2 text-left font-semibold border-l border-[#efefeb]">День в amo</th>
              <th className={th}>Звонки исх. / дозвон</th>
              <th className={th}>Входящие</th>
              <th className={th}>Сообщения</th>
              <th className={th}>Сделок двинуто</th>
              <th className={th}>КП · счета</th>
              <th className={`${th} border-l border-[#efefeb]`}>Продажи</th>
              <th className={th}>Поступило</th>
              <th className={`${th} pr-3`}>Разговоры → замеры → оплаты</th>
            </tr>
          </thead>
          <tbody>
            {people.map(p => {
              const r = p.row
              const c = r ? calls(r) : null
              const worked = r && (r.actions > 0 || (r.pbx_out ?? 0) > 0)
              return (
                <tr key={p.amoUserId} className="border-b border-[#efefeb] hover:bg-[#fafaf8]">
                  <td className="px-3 py-2.5 font-semibold whitespace-nowrap">
                    <Link href={`/?m=${p.amoUserId}`} className="hover:text-blue-600">{p.name} ›</Link>
                  </td>
                  <td className="px-2 py-2.5 whitespace-nowrap border-l border-[#efefeb]">
                    {worked ? `${hm(r!.first_at) ?? '—'} – ${hm(r!.last_at) ?? '—'}` : <span className="text-[#9a9a95]">нет действий</span>}
                  </td>
                  <td className={td}>{c ? `${c.out} / ${c.ok}` : '—'}</td>
                  <td className={td}>{c ? `${c.in}${c.missed ? ` · пропущ. ${c.missed}` : ''}` : '—'}</td>
                  <td className={td}>{r ? r.messages_own + r.messages_no_author : '—'}</td>
                  <td className={td}>{r ? r.cards_moved : '—'}</td>
                  <td className={td}>{r && r.adv_kp != null ? `${r.adv_kp} · ${r.adv_invoice ?? 0}` : '—'}</td>
                  <td className={`${td} border-l border-[#efefeb]`}>{p.month.salesCount} · {rub(p.month.salesSum)}</td>
                  <td className={`${td} font-semibold`}>{rub(p.month.prepay + p.month.remainder)}</td>
                  <td className={`${td} pr-3`}>{p.month.talks} → {p.month.measureAssigned} → {p.month.measureDone} → {p.month.payments}</td>
                </tr>
              )
            })}
            <tr className="bg-[#fafaf8] font-bold">
              <td className="px-3 py-2.5">Итого</td>
              <td className="px-2 py-2.5 border-l border-[#efefeb]"></td>
              <td className={td}>{tot.out} / {tot.ok}</td>
              <td className={td}>{tot.in}{tot.missed ? ` · пропущ. ${tot.missed}` : ''}</td>
              <td className={td}>{tot.msgs}</td>
              <td className={td}>{tot.moved}</td>
              <td className={td}>{tot.kp} · {tot.inv}</td>
              <td className={`${td} border-l border-[#efefeb]`}>{tot.salesN} · {rub(tot.sales)}</td>
              <td className={td}>{rub(tot.money)}</td>
              <td className={`${td} pr-3`}></td>
            </tr>
          </tbody>
        </table>
      </div>

      {notes.length > 0 && (
        <div className="bg-white border border-[#e4e4e0] rounded-xl px-4 py-2">
          <p className="text-[11px] font-semibold text-[#6b6b66] uppercase tracking-wider py-2">Что заметить</p>
          {notes.map((n, i) => (
            <p key={i} className="text-[13px] text-[#3d3d3a] py-1.5 border-t border-[#efefeb]"><b className="text-[#111110]">{n.who}:</b> {n.t}</p>
          ))}
        </div>
      )}

      <p className="text-[11px] text-[#6b6b66] leading-relaxed">
        День — снимок в 6:30 из AmoCRM и АТС, правило подсчёта то же, что на «Рабочем дне AMO»; «день в amo» — первое и последнее
        своё действие в CRM, а не приход. КП и счета — вход сделки в этапы «КП отправлено» и «Счёт выставлен». Продажи — «Продажи
        M-Glass»; поступления и путь клиентов — «Аналитика дохода», загрузка в 8:05.
        {bookLastDay && bookLastDay < yesterday && <span className="text-amber-700"> Книга заполнена по {dm(bookLastDay)}.</span>}
      </p>
    </section>
  )
}
